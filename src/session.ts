// The sundhed.dk session lives in one real browser that this process owns.
// The person logs in with MitID in its window; every API call then runs as a
// fetch() inside that browser, so cookies and headers are exactly the site's own.
// Nothing is written to disk: the context is in-memory and dies with the process.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

export const ORIGIN = "https://www.sundhed.dk";
// What sundhed.dk's own "Log på" button opens: it redirects through
// login.sundhed.dk and NemLog-in to MitID, and returns to Min Side after.
const LOGIN_URL = `${ORIGIN}/login/unsecure/logon.ashx?ReturnUrl=/borger/min-side/`;
// Each Min Side app has its own backend, and its page sets up that backend's
// auth when it loads. Before calling an app's API, its page is loaded once.
const APP_PAGES: Record<string, string> = {
  minsideportal: "/borger/min-side/",
  medicinkort2borger: "/borger/min-side/min-sundhedsjournal/medicinkortet/",
  vaccination: "/borger/min-side/min-sundhedsjournal/vaccinationer/",
  proevesvarportal: "/borger/min-side/min-sundhedsjournal/laboratoriesvar/",
  dennationalehenvisningsformidling: "/borger/min-side/min-sundhedsjournal/henvisninger/",
};
// Headers the browser sets itself (and HTTP/2 pseudo-headers like :path); anything else an app's page sends is the app's own.
const BROWSER_HEADERS = /^(:.*|accept|accept-encoding|accept-language|user-agent|referer|origin|cookie|host|connection|content-length|content-type|priority|sec-.*)$/i;
const BOOT_WAIT_MS = 30_000;
const LOGIN_WAIT_MS = 3 * 60_000;
const POLL_MS = 2_000;
const KEEPALIVE_MS = Number(process.env.SUNDHEDMCP_KEEPALIVE_MS ?? 4 * 60_000);

/** The person is not logged in, or sundhed.dk ended the session. */
export class SessionGone extends Error {
  constructor() {
    super("Not logged in to sundhed.dk. Call connect_sundhed and approve the login in MitID.");
  }
}

interface State {
  browser: Browser;
  context: BrowserContext;
  /** The visible window where MitID happens. */
  login: Page;
  /** A background tab on sundhed.dk that runs the API calls. */
  api: Page | null;
  /** Per app: the extra headers its own page sends to its API, learned by loading that page. */
  apps: Map<string, Record<string, string>>;
  connectedAt: Date | null;
  lastConfirmedAt: Date | null;
  endedAt: Date | null;
  /** How long the previous session lasted, for learning sundhed.dk's timeout. */
  lastSessionMinutes: number | null;
  keepAlive: NodeJS.Timeout | null;
}

let state: State | null = null;
let launching: Promise<State> | null = null;

// Hosted mode: the browser runs headless on a server, and the person logs in
// through the /connect page, which shows it as screenshots and forwards input.
let hostedBaseUrl: string | null = null;
const VIEWPORT = { width: 1000, height: 760 };

export function configureHosted(baseUrl: string): void {
  hostedBaseUrl = baseUrl;
}

/** Where to log in when hosted, or null when running locally with a real window. */
export const hostedLoginUrl = () => (hostedBaseUrl ? `${hostedBaseUrl}/connect` : null);

const log = (msg: string) => console.error(`[sundhed] ${msg}`);

/** Installed browsers first (MitID treats them like any other), bundled Chromium last. */
async function launchBrowser(): Promise<Browser> {
  const preferred = process.env.SUNDHEDMCP_BROWSER;
  const channels = preferred ? [preferred] : ["chrome", "msedge", "chrome-beta", "chrome-canary", "chromium"];
  const errors: string[] = [];
  for (const channel of channels) {
    try {
      const browser = await chromium.launch({ headless: hostedBaseUrl !== null, channel, args: ["--window-size=1100,900"] });
      log(`using browser channel "${channel}"`);
      return browser;
    } catch (err) {
      errors.push(`${channel}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  throw new Error(
    "No Chromium-based browser found. Install Google Chrome or Microsoft Edge, or run `npx playwright-core install chromium`. Tried: " +
      errors.join("; "),
  );
}

async function ensureBrowser(): Promise<State> {
  if (state) return state;
  launching ??= (async () => {
    const browser = await launchBrowser();
    const context = await browser.newContext({ locale: "da-DK", viewport: hostedBaseUrl ? VIEWPORT : null });
    const login = await context.newPage();
    const s: State = { browser, context, login, api: null, apps: new Map(), connectedAt: null, lastConfirmedAt: null, endedAt: null, lastSessionMinutes: null, keepAlive: null };
    browser.on("disconnected", () => {
      if (state === s) reset("browser closed");
    });
    // Closing the login window is how a person says "stop": take the browser down with it.
    login.on("close", () => {
      if (state === s) void browser.close().catch(() => {});
    });
    state = s;
    return s;
  })().finally(() => {
    launching = null;
  });
  return launching;
}

function reset(reason: string): void {
  if (!state) return;
  if (state.keepAlive) clearInterval(state.keepAlive);
  log(`session gone (${reason})`);
  state = null;
}

async function setWindow(page: Page, windowState: "minimized" | "normal"): Promise<void> {
  if (hostedBaseUrl) return;
  try {
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState } });
    await cdp.detach();
    if (windowState === "normal") await page.bringToFront();
  } catch {
    // Window management is a nicety; the session works either way.
  }
}

/** Asks sundhed.dk directly, using the context's cookies. Needs no page. */
async function checkLoggedIn(s: State): Promise<boolean> {
  try {
    const res = await s.context.request.get(`${ORIGIN}/api/login/isloggedin`, { headers: { Accept: "application/json" } });
    if (!res.ok()) return false;
    const body = (await res.json()) as { IsLoggedIn?: boolean };
    return body.IsLoggedIn === true;
  } catch {
    return false;
  }
}

async function apiPage(s: State): Promise<Page> {
  if (s.api && !s.api.isClosed()) return s.api;
  s.api = await s.context.newPage();
  s.apps.clear();
  return s.api;
}

const appOf = (path: string) => (path.match(/^\/app\/([^/]+)\//)?.[1] ?? "").toLowerCase();

/**
 * Loads the app's own page in the background tab and records the extra headers
 * its scripts send to the app's API (an auth token, an anti-forgery header).
 * Only the header names are logged.
 */
async function bootApp(s: State, app: string): Promise<void> {
  const page = await apiPage(s);
  const pagePath = APP_PAGES[app];
  if (!pagePath) {
    s.apps.set(app, {});
    return;
  }
  let captured: Record<string, string> | null = null;
  const seen = new Promise<void>((resolve) => {
    const onRequest = async (req: import("playwright-core").Request) => {
      if (appOf(new URL(req.url()).pathname) !== app || !new URL(req.url()).pathname.includes("/api/")) return;
      const headers = await req.allHeaders().catch(() => ({}) as Record<string, string>);
      captured = Object.fromEntries(Object.entries(headers).filter(([k]) => !BROWSER_HEADERS.test(k)));
      page.off("request", onRequest);
      resolve();
    };
    page.on("request", onRequest);
  });
  await page.goto(`${ORIGIN}${pagePath}`, { waitUntil: "domcontentloaded" });
  await Promise.race([seen, page.waitForLoadState("networkidle", { timeout: BOOT_WAIT_MS }).catch(() => {})]);
  await Promise.race([seen, new Promise((r) => setTimeout(r, 2_000))]);
  const headers: Record<string, string> = captured ?? {};
  s.apps.set(app, headers);
  log(`${app}: page loaded, ${captured ? `extra headers: ${Object.keys(headers).join(", ") || "none"}` : "no API call seen"}`);
}

function markConnected(s: State): void {
  const now = new Date();
  s.connectedAt ??= now;
  s.lastConfirmedAt = now;
  s.endedAt = null;
  if (!s.keepAlive && KEEPALIVE_MS > 0) {
    s.keepAlive = setInterval(() => void keepAlive(s), KEEPALIVE_MS);
    s.keepAlive.unref();
  }
}

function markEnded(s: State): void {
  if (s.keepAlive) clearInterval(s.keepAlive);
  s.keepAlive = null;
  if (s.connectedAt) {
    s.endedAt = new Date();
    s.lastSessionMinutes = minutesBetween(s.connectedAt, s.endedAt);
    log(`sundhed.dk ended the session after ${s.lastSessionMinutes} min`);
  }
  s.connectedAt = null;
}

/** Touches an authenticated page so sundhed.dk sees activity and keeps the session. */
async function keepAlive(s: State): Promise<void> {
  if (state !== s) return;
  try {
    await apiGet("/app/minsideportal/api/v1/GetLoginInfo");
    if (!(await checkLoggedIn(s))) markEnded(s);
  } catch (err) {
    if (err instanceof SessionGone) return;
    log(`keep-alive failed: ${(err as Error).message}`);
  }
}

/**
 * Goes straight to the MitID step: the login redirect, then NemLog-in's
 * "Fortsæt til login" button, so the person lands on the user ID field.
 */
async function openMitId(page: Page): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  try {
    await page.locator("#mitIDConfirmation").click({ timeout: 15_000 });
  } catch {
    // NemLog-in changed or skipped the step; the person can click on from here.
  }
}

const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

export type ConnectResult = { connected: true; since: Date } | { connected: false; reason: string };

/**
 * Opens (or re-shows) the browser window on sundhed.dk and waits for the person
 * to log in with MitID. Returns once logged in or after LOGIN_WAIT_MS.
 */
export async function connect(): Promise<ConnectResult> {
  const s = await ensureBrowser();
  if (await checkLoggedIn(s)) {
    markConnected(s);
    return { connected: true, since: s.connectedAt! };
  }
  markEnded(s);
  await setWindow(s.login, "normal");
  // Leave the window alone if the person is already partway through MitID.
  if (!s.login.url().includes("mitid") && !s.login.url().includes("nemlog-in")) {
    await openMitId(s.login);
  }
  const deadline = Date.now() + LOGIN_WAIT_MS;
  while (Date.now() < deadline) {
    if (state !== s) return { connected: false, reason: "The browser window was closed before the login finished." };
    if (await checkLoggedIn(s)) {
      markConnected(s);
      await apiPage(s);
      await setWindow(s.login, "minimized");
      return { connected: true, since: s.connectedAt! };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { connected: false, reason: "Still waiting for the MitID login. The window stays open; log in there, then ask again." };
}

export interface Status {
  browserOpen: boolean;
  loggedIn: boolean;
  connectedMinutes?: number;
  lastSessionLastedMinutes?: number;
}

export async function status(): Promise<Status> {
  const s = state;
  if (!s) return { browserOpen: false, loggedIn: false };
  const loggedIn = await checkLoggedIn(s);
  if (loggedIn) markConnected(s);
  else if (s.connectedAt) markEnded(s);
  const now = new Date();
  return {
    browserOpen: true,
    loggedIn,
    ...(loggedIn && s.connectedAt ? { connectedMinutes: minutesBetween(s.connectedAt, now) } : {}),
    ...(!loggedIn && s.lastSessionMinutes !== null ? { lastSessionLastedMinutes: s.lastSessionMinutes } : {}),
  };
}

export async function disconnect(): Promise<void> {
  const s = state;
  if (!s) return;
  reset("disconnected");
  await s.browser.close().catch(() => {});
}

// Calls share one background tab, and loading an app's page navigates it, so
// calls run one at a time.
let queue: Promise<unknown> = Promise.resolve();

/** GET a sundhed.dk path (e.g. "/app/vaccination/api/v1/overview") as JSON, inside the logged-in browser. */
export function apiGet(path: string): Promise<unknown> {
  const run = queue.then(() => apiGetNow(path));
  queue = run.catch(() => {});
  return run;
}

async function apiGetNow(path: string): Promise<unknown> {
  const s = state;
  if (!s) throw new SessionGone();
  if (!s.connectedAt) {
    // The login may have finished on the /connect page since the last call.
    if (!(await checkLoggedIn(s))) throw new SessionGone();
    markConnected(s);
  }
  const app = appOf(path);
  let res = await fetchInPage(s, app, path);
  if (res.status === 401 || res.status === 403) {
    // The app's own auth may have expired: load its page again and retry once.
    s.apps.delete(app);
    res = await fetchInPage(s, app, path);
  }
  if (res.status === 401 || res.status === 403) {
    if (!(await checkLoggedIn(s))) {
      markEnded(s);
      throw new SessionGone();
    }
    throw new Error(`sundhed.dk refused ${app || "this"} data (${res.status}) although you are logged in. The site may have changed how this app signs in.`);
  }
  if (res.status >= 400) throw new Error(`sundhed.dk answered ${res.status} for ${path.split("?")[0]}`);
  if (!res.type.includes("json")) throw new Error(`sundhed.dk did not answer with JSON for ${path.split("?")[0]}; the site may have changed.`);
  s.lastConfirmedAt = new Date();
  return res.text ? JSON.parse(res.text) : null;
}

async function fetchInPage(s: State, app: string, path: string) {
  if (!s.apps.has(app)) await bootApp(s, app);
  const page = await apiPage(s);
  return page.evaluate(
    async ({ url, headers }) => {
      const r = await fetch(url, { headers: { Accept: "application/json", ...headers }, credentials: "include" });
      return { status: r.status, type: r.headers.get("content-type") ?? "", text: await r.text() };
    },
    { url: path, headers: s.apps.get(app) ?? {} },
  );
}

// --- Hosted login: the /connect page drives the login tab from afar ---

let watching = false;

/** Notices when the login finishes, so the session is ready before the next tool call. */
function watchForLogin(s: State): void {
  if (watching) return;
  watching = true;
  const deadline = Date.now() + 15 * 60_000;
  const tick = async () => {
    if (state !== s || Date.now() > deadline) return void (watching = false);
    if (await checkLoggedIn(s)) {
      watching = false;
      markConnected(s);
      log("logged in through the /connect page");
      return;
    }
    setTimeout(() => void tick(), POLL_MS);
  };
  void tick();
}

/** Starts the browser on sundhed.dk's login page if needed. True when already logged in. */
export async function startLogin(): Promise<boolean> {
  const s = await ensureBrowser();
  if (await checkLoggedIn(s)) {
    markConnected(s);
    return true;
  }
  if (!s.login.url().startsWith("http")) await openMitId(s.login);
  watchForLogin(s);
  return false;
}

/**
 * Starts the MitID login over in a fresh browser. Reusing the old one fails:
 * NemLog-in remembers the half-finished login and answers "Du er allerede
 * logget ind" (you cannot run two login flows at once).
 */
export async function restartLogin(): Promise<void> {
  await disconnect();
  watching = false;
  await startLogin();
}

export async function loginScreenshot(): Promise<Buffer | null> {
  const s = state;
  if (!s || s.login.isClosed()) return null;
  return s.login.screenshot({ type: "jpeg", quality: 70 });
}

export type LoginInput =
  | { type: "click"; x: number; y: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string }
  | { type: "wheel"; dy: number };

// Only the keys a login form needs. Everything else arrives as text.
const KEYS = new Set(["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

export async function loginInput(input: LoginInput): Promise<void> {
  const s = state;
  if (!s || s.login.isClosed()) return;
  const page = s.login;
  switch (input.type) {
    case "click": {
      const x = Math.max(0, Math.min(VIEWPORT.width, input.x));
      const y = Math.max(0, Math.min(VIEWPORT.height, input.y));
      await page.mouse.click(x, y);
      break;
    }
    case "text":
      await page.keyboard.insertText(input.text.slice(0, 200));
      break;
    case "key":
      if (KEYS.has(input.key)) await page.keyboard.press(input.key === "Space" ? " " : input.key);
      break;
    case "wheel":
      await page.mouse.wheel(0, Math.max(-2000, Math.min(2000, input.dy)));
      break;
  }
}

export const loginViewport = () => VIEWPORT;

/**
 * True when MitID asks for its QR code. MitID does that when the login comes
 * from a browser it does not recognise, such as this server's; the code has to
 * be scanned from a screen the person can point their phone at.
 */
export async function loginWantsQr(): Promise<boolean> {
  const s = state;
  if (!s || s.login.isClosed()) return false;
  // A string expression: it runs in the page, and this project has no DOM types.
  const text = await s.login.evaluate<string>("document.body ? document.body.innerText : ''").catch(() => "");
  return /scan qr/i.test(text);
}
