// Hosted mode over HTTP: the MCP endpoint behind OAuth, the OAuth server
// itself, and the owner-only /connect page for logging in with MitID.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, MIN_PASSWORD_LENGTH, passwordConfigured, passwordFingerprint, setPassword, setupProblems } from "./config.ts";
import { store } from "./store.ts";
import { SingleUserProvider, verifyPassword } from "./auth.ts";
import { connectPage, connectSignInPage, firstRunPage, LANG_COOKIE, langOf, loginPage, returningPage, signedInPage, signInFailedPage, statusPage } from "./pages.ts";
import { createServer, VERSION } from "./mcp.ts";
import { loginInput, loginScreenshot, loginViewport, loginWantsQr, restartLogin, startLogin, status, type LoginInput } from "./session.ts";

const VIEWER_COOKIE = "sundhed_viewer";
const VIEWER_TTL_MS = 30 * 60_000;

export function createApp() {
  const log = (msg: string) => console.log(`[sundhed ${new Date().toISOString()}] ${msg}`);

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  const strictCsp = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
  app.use((_req, res, next) => {
    res.set({ "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": strictCsp });
    next();
  });

  const baseUrl = new URL(config.baseUrl);
  const mcpUrl = new URL("/mcp", baseUrl);
  const provider = new SingleUserProvider(store(), {
    onLogin: (e) => log(`${e.ok ? "sign-in" : `failed sign-in (${e.reason})`} from ${e.ip}${e.clientName ? ` for ${e.clientName}` : ""}`),
  });

  // Changing the admin password logs every client out.
  function syncPasswordFingerprint(): void {
    if (!passwordConfigured()) return;
    const fingerprint = passwordFingerprint();
    if (store().data.password_fingerprint && store().data.password_fingerprint !== fingerprint) {
      provider.revokeAll();
      log("admin password changed: all tokens revoked");
    }
    if (store().data.password_fingerprint !== fingerprint) store().update((d) => void (d.password_fingerprint = fingerprint));
  }
  syncPasswordFingerprint();

  // --- Icons ---

  const icon = (file: string, type: string) => {
    const body = readFileSync(new URL(`./assets/${file}`, import.meta.url));
    return (_req: express.Request, res: express.Response) => void res.set("Cache-Control", "public, max-age=86400").type(type).send(body);
  };
  app.get("/favicon.svg", icon("favicon.svg", "image/svg+xml"));
  app.get("/favicon.ico", icon("favicon.ico", "image/x-icon"));
  app.get("/apple-touch-icon.png", icon("apple-touch-icon.png", "image/png"));

  // --- Status and health ---

  app.get("/", async (req, res) => {
    if (!passwordConfigured()) return void res.type("html").send(firstRunPage(langOf(req), { minLength: MIN_PASSWORD_LENGTH }));
    const s = await status().catch(() => ({ loggedIn: false }));
    res.type("html").send(statusPage(langOf(req), { problems: setupProblems(), mcpUrl: mcpUrl.href, loggedIn: s.loggedIn }));
  });
  // DK | EN toggle on the server pages. Only same-site paths are accepted as the way back.
  app.get("/lang/:lang", (req, res) => {
    const lang = req.params.lang === "en" ? "en" : "da";
    const back = String(req.query.back ?? "/");
    const safe = back.startsWith("/") && !back.startsWith("//") ? back : "/";
    res.set("Set-Cookie", `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${baseUrl.protocol === "https:" ? "; Secure" : ""}`).redirect(303, safe);
  });

  // First run: whoever deploys the server chooses its password here, once.
  app.post("/setup", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    if (passwordConfigured()) return void res.status(404).type("html").send(signInFailedPage(langOf(req), "This server already has a password."));
    const { password = "", confirm = "" } = req.body as Record<string, string | undefined>;
    const error =
      password.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : password !== confirm ? "The two passwords are not the same." : "";
    if (error) return void res.status(400).type("html").send(firstRunPage(langOf(req), { minLength: MIN_PASSWORD_LENGTH, error }));
    setPassword(password);
    syncPasswordFingerprint();
    log(`password set on the first-run page from ${req.ip}`);
    res.redirect(303, "/");
  });

  app.get("/healthz", (_req, res) => void res.json({ ok: true, version: VERSION }));

  // --- /connect: the owner logs in with MitID through the server's browser ---

  // Viewer sessions live in memory. Anyone holding one can drive a logged-in
  // health record, so they need the admin password and expire quickly.
  const viewers = new Map<string, number>();
  const failures = new Map<string, { count: number; until: number }>();
  const viewerOk = (req: express.Request) => {
    const cookie = String(req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${VIEWER_COOKIE}=`));
    const id = cookie?.slice(VIEWER_COOKIE.length + 1);
    const expires = id ? viewers.get(createHash("sha256").update(id).digest("hex")) : undefined;
    return expires !== undefined && expires > Date.now();
  };
  const requireViewer: express.RequestHandler = (req, res, next) => (viewerOk(req) ? next() : void res.status(401).json({ error: "Sign in at /connect" }));

  app.get("/connect", async (req, res) => {
    if (setupProblems().length || !passwordConfigured()) return void res.redirect(303, "/");
    if (!viewerOk(req)) return void res.type("html").send(connectSignInPage(langOf(req)));
    await startLogin().catch((err) => log(`could not start the browser: ${(err as Error).message}`));
    // The viewer page runs one inline script and shows screenshots as blob: images.
    res
      .set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
      .type("html")
      .send(connectPage(langOf(req), loginViewport()));
  });

  app.post("/connect/signin", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    const ip = req.ip ?? "unknown";
    const f = failures.get(ip);
    if (f && f.until > Date.now()) return void res.status(429).type("html").send(connectSignInPage(langOf(req), "Too many attempts. Try again in 15 minutes."));
    if (!verifyPassword(String((req.body as Record<string, string>).password ?? ""))) {
      const next = { count: (f?.count ?? 0) + 1, until: 0 };
      if (next.count >= 5) next.until = Date.now() + 15 * 60_000;
      failures.set(ip, next);
      log(`failed /connect sign-in from ${ip}`);
      return void res.status(401).type("html").send(connectSignInPage(langOf(req), "Wrong password."));
    }
    failures.delete(ip);
    for (const [k, v] of viewers) if (v < Date.now()) viewers.delete(k);
    const id = randomBytes(32).toString("base64url");
    viewers.set(createHash("sha256").update(id).digest("hex"), Date.now() + VIEWER_TTL_MS);
    log(`/connect sign-in from ${ip}`);
    const secure = baseUrl.protocol === "https:" ? "; Secure" : "";
    res.set("Set-Cookie", `${VIEWER_COOKIE}=${id}; Path=/connect; HttpOnly; SameSite=Strict; Max-Age=${VIEWER_TTL_MS / 1000}${secure}`).redirect(303, "/connect");
  });

  app.get("/connect/frame", requireViewer, async (_req, res) => {
    const jpeg = await loginScreenshot().catch(() => null);
    if (!jpeg) return void res.status(204).end();
    res.set("Cache-Control", "no-store").type("image/jpeg").send(jpeg);
  });

  app.post("/connect/input", requireViewer, express.json({ limit: "4kb" }), async (req, res) => {
    const input = req.body as LoginInput;
    if (!input || !["click", "text", "key", "wheel"].includes(input.type)) return void res.status(400).json({ error: "Unknown input" });
    await loginInput(input).catch((err) => log(`input failed: ${(err as Error).message}`));
    res.status(204).end();
  });

  app.post("/connect/restart", requireViewer, async (_req, res) => {
    await restartLogin().catch((err) => log(`restart failed: ${(err as Error).message}`));
    res.status(204).end();
  });

  app.get("/connect/status", requireViewer, async (_req, res) => {
    const s = await status().catch(() => ({ loggedIn: false }));
    const qr = s.loggedIn ? false : await loginWantsQr().catch(() => false);
    res.set("Cache-Control", "no-store").json({ loggedIn: s.loggedIn, qr });
  });

  // --- OAuth server for the MCP connector (single user) ---

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: baseUrl,
      resourceServerUrl: mcpUrl,
      resourceName: "SundhedMCP",
      scopesSupported: ["sundhed:read"],
      clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
    }),
  );

  app.post("/login", express.urlencoded({ extended: false }), (req, res) => {
    const { request, password } = req.body as Record<string, string | undefined>;
    const result = provider.completeLogin(String(request ?? ""), String(password ?? ""), req.ip ?? "unknown");
    if ("redirect" in result) return void res.status(200).type("html").send(returningPage(langOf(req), result.redirect));
    if ("done" in result) return void res.status(200).type("html").send(signedInPage(langOf(req)));
    if (result.requestId) return void res.status(401).type("html").send(loginPage(langOf(req), { requestId: result.requestId, error: result.error }));
    res.status(400).type("html").send(signInFailedPage(langOf(req), result.error));
  });

  // --- MCP endpoint (stateless: one transport per request; the sundhed.dk session is process-wide) ---

  const bearer = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });

  app.post(["/mcp", "/"], bearer, express.json({ limit: "1mb" }), async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log(`mcp request failed: ${(err as Error).message}`);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });
  app.get("/mcp", bearer, (_req, res) => void res.status(405).set("Allow", "POST").json({ error: "This server is stateless; use POST." }));
  app.delete("/mcp", bearer, (_req, res) => void res.status(405).set("Allow", "POST").json({ error: "This server is stateless; use POST." }));

  return app;
}
