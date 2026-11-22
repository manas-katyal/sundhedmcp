// Hosted mode over HTTP: the MCP endpoint behind OAuth, the OAuth server
// itself, and the owner-only /connect page for logging in with MitID.
// With several people (oidc.ts) there is no OAuth server or password here:
// /mcp checks the identity provider's tokens, /connect signs in with it, and
// each person reaches only their own session and saved copy (users.ts).
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, MIN_API_TOKEN_LENGTH, MIN_PASSWORD_LENGTH, passwordConfigured, passwordFingerprint, setPassword, setupProblems } from "./config.ts";
import { store } from "./store.ts";
import { passwordLocked, SingleUserProvider, verifyPassword } from "./auth.ts";
import { BUSY_SCRIPT_HASH, connectPage, connectSignInPage, firstRunPage, LANG_COOKIE, langOf, loginPage, returningPage, signedInPage, signInFailedPage, statusPage } from "./pages.ts";
import { createServer, VERSION } from "./mcp.ts";
import { isLocal, mountGuide, type GuideOptions } from "./guide.ts";
import { currentSession, loginViewport, type LoginInput, SessionGone, type SundhedSession } from "@sundhedmcp/session";
import { createConnectSignIn, createTokenVerifier, type OidcConfig, type OidcDeps, onlyListsTools, protectedResourceMetadata, requireCaller } from "./oidc.ts";
import { asOwner, defaultCopy, PART_NAMES, type SavedCopy } from "./snapshot.ts";
import { type ApiCaller, mountApi } from "./api.ts";
import { AUTO_STOP, dashboardPage, type DashboardInput, PART_SLUGS, partOfSlug, partPage, renewalFormPage, renewalResultPage, renewalsPage, renewalTexts } from "./dashboard.ts";
import { addRule, cooldownMs, loadAutoRenew, stopRule } from "./auto-renew.ts";
import { RenewalError, renewalChoices, renewalOverview, sendRenewal } from "./renewal.ts";
import { syncStatus } from "./sync.ts";
import { httpTelemetry } from "./telemetry.ts";
import type { Users } from "./users.ts";

const VIEWER_COOKIE = "sundhed_viewer";
const VIEWER_TTL_MS = 30 * 60_000;

/** Several people, each signed in with the identity provider. */
export interface MultiUser {
  oidc: OidcConfig;
  users: Users;
  deps?: OidcDeps;
}

/** `guide` is set by `sundhedmcp serve`, where your own computer is the server. */
export function createApp(guide?: GuideOptions, multi?: MultiUser) {
  const log = (msg: string) => console.log(`[sundhed ${new Date().toISOString()}] ${msg}`);

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(httpTelemetry());
  const strictCsp = `default-src 'none'; font-src 'self'; style-src 'unsafe-inline'; script-src ${BUSY_SCRIPT_HASH}; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
  app.use((_req, res, next) => {
    res.set({ "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": strictCsp });
    next();
  });

  const baseUrl = new URL(config.baseUrl);
  const mcpUrl = new URL("/mcp", baseUrl);
  const provider = new SingleUserProvider(store(), {
    onLogin: (e) => log(`${e.ok ? "sign-in" : `failed sign-in (${e.reason})`} from ${e.ip}${e.clientName ? ` for ${e.clientName}` : ""}`),
    apiTokens: config.apiTokens.filter((t) => t.length >= MIN_API_TOKEN_LENGTH),
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
  if (!multi) syncPasswordFingerprint();

  // --- Icons ---

  const icon = (file: string, type: string) => {
    const body = readFileSync(new URL(`./assets/${file}`, import.meta.url));
    return (_req: express.Request, res: express.Response) => void res.set("Cache-Control", "public, max-age=86400").type(type).send(body);
  };
  app.get("/favicon.svg", icon("favicon.svg", "image/svg+xml"));
  app.get("/favicon.ico", icon("favicon.ico", "image/x-icon"));
  app.get("/apple-touch-icon.png", icon("apple-touch-icon.png", "image/png"));
  // IBM Plex, sundhedmcp.dk's typeface, served from here so no page calls a font host.
  for (const font of ["IBMPlexSans.woff2", "IBMPlexMono-400.woff2", "IBMPlexMono-500.woff2"]) {
    const body = readFileSync(new URL(`./assets/fonts/${font}`, import.meta.url));
    app.get(`/fonts/${font}`, (_req, res) => void res.set("Cache-Control", "public, max-age=31536000, immutable").type("font/woff2").send(body));
  }

  // --- Status and health ---

  // Cookies are Secure behind HTTPS, but not on http://localhost, where Safari would drop them.
  const secureFor = (req: express.Request) => (baseUrl.protocol === "https:" && !/^(localhost|127\.0\.0\.1)(:|$)/.test(String(req.headers.host ?? "")) ? "; Secure" : "");

  if (guide) mountGuide(app, guide);

  app.get("/", async (req, res) => {
    if (guide && isLocal(req, guide.port)) return void res.redirect(303, "/guide");
    // Whose session it is depends on who signs in at /connect.
    if (multi) return void res.type("html").send(statusPage(langOf(req), { problems: setupProblems(), mcpUrl: mcpUrl.href }));
    if (!passwordConfigured()) return void res.type("html").send(firstRunPage(langOf(req), { minLength: MIN_PASSWORD_LENGTH }));
    const s = await currentSession().status().catch(() => ({ loggedIn: false }));
    res.type("html").send(statusPage(langOf(req), { problems: setupProblems(), mcpUrl: mcpUrl.href, loggedIn: s.loggedIn }));
  });
  // DK | EN toggle on the server pages. Only same-site paths are accepted as the way back.
  app.get("/lang/:lang", (req, res) => {
    const lang = req.params.lang === "en" ? "en" : "da";
    const back = String(req.query.back ?? "/");
    const safe = back.startsWith("/") && !back.startsWith("//") ? back : "/";
    res.set("Set-Cookie", `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${secureFor(req)}`).redirect(303, safe);
  });

  // First run: whoever deploys the server chooses its password here, once.
  // Under `serve` only this computer may choose it: Funnel can already be on
  // (it survives restarts), and the first password set wins the record.
  // A form posted from another site carries its Origin, so refuse that too.
  const setupAllowed = (req: express.Request) => {
    if (guide && !isLocal(req, guide.port)) return false;
    const origin = req.headers.origin;
    return !origin || origin === baseUrl.origin || origin === `${req.protocol}://${req.headers.host}`;
  };
  app.post("/setup", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    if (multi) return void res.status(404).type("html").send(signInFailedPage(langOf(req), "This server signs people in with its identity provider; it has no password."));
    if (!setupAllowed(req)) return void res.status(403).type("html").send(signInFailedPage(langOf(req), "Choose the password on the computer that runs SundhedMCP."));
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
  // health record, so they need the admin password (or, with several people,
  // a sign-in with the identity provider) and expire quickly.
  const viewers = new Map<string, number>();
  const failures = new Map<string, { count: number; until: number }>();
  const viewerOk = (req: express.Request) => {
    const cookie = String(req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${VIEWER_COOKIE}=`));
    const id = cookie?.slice(VIEWER_COOKIE.length + 1);
    const expires = id ? viewers.get(createHash("sha256").update(id).digest("hex")) : undefined;
    return expires !== undefined && expires > Date.now();
  };
  const signIn = multi ? createConnectSignIn(multi.oidc, baseUrl, log, multi.deps) : null;
  signIn?.mount(app);

  /** The copy (and session) this browser may see and drive: the owner's, or the signed-in person's own. Null when not signed in. */
  async function viewerCopy(req: express.Request): Promise<SavedCopy | null> {
    if (!multi || !signIn) return viewerOk(req) ? defaultCopy : null;
    const person = signIn.signedIn(req);
    return person ? multi.users.get(person.caller) : null;
  }
  async function viewerSession(req: express.Request): Promise<SundhedSession | null> {
    if (!multi && viewerOk(req)) return currentSession();
    return (await viewerCopy(req))?.session ?? null;
  }
  const requireViewer: express.RequestHandler = (req, res, next) => {
    // The viewer page's own scripts send its Origin; another site's do too. A
    // form on these pages sends "Origin: null" (Referrer-Policy: no-referrer),
    // so for that the browser's own Sec-Fetch-Site must say same-origin.
    const origin = req.headers.origin;
    const sameOrigin = origin === baseUrl.origin || ((origin === undefined || origin === "null") && req.headers["sec-fetch-site"] === "same-origin");
    if (multi && req.method === "POST" && !sameOrigin) return void res.status(403).json({ error: "Forbidden" });
    viewerSession(req).then(
      (session) => {
        if (!session) return void res.status(401).json({ error: "Sign in at /connect" });
        res.locals.session = session;
        next();
      },
      (err: unknown) => {
        log(`could not open a session: ${(err as Error).message}`);
        res.status(500).json({ error: "Could not open your session" });
      },
    );
  };
  const sessionOf = (res: express.Response) => res.locals.session as SundhedSession;

  app.get("/connect", async (req, res) => {
    if (setupProblems().length || (!multi && !passwordConfigured())) return void res.redirect(303, "/");
    const session = await viewerSession(req).catch(() => null);
    if (!session) {
      if (multi) return void res.redirect(303, "/connect/login");
      return void res.type("html").send(connectSignInPage(langOf(req)));
    }
    await session.startLogin().catch((err) => log(`could not start the browser: ${(err as Error).message}`));
    // The viewer page runs one inline script and shows screenshots as blob: images.
    res
      .set("Content-Security-Policy", "default-src 'none'; font-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
      .type("html")
      .send(connectPage(langOf(req), loginViewport()));
  });

  app.post("/connect/signin", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    if (multi) return void res.redirect(303, "/connect/login");
    const ip = req.ip ?? "unknown";
    const f = failures.get(ip);
    if ((f && f.until > Date.now()) || passwordLocked()) return void res.status(429).type("html").send(connectSignInPage(langOf(req), "Too many attempts. Try again in 15 minutes."));
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
    const secure = secureFor(req);
    res.set("Set-Cookie", `${VIEWER_COOKIE}=${id}; Path=/connect; HttpOnly; SameSite=Strict; Max-Age=${VIEWER_TTL_MS / 1000}${secure}`).redirect(303, "/connect");
  });

  app.get("/connect/frame", requireViewer, async (_req, res) => {
    const jpeg = await sessionOf(res).loginScreenshot().catch(() => null);
    if (!jpeg) return void res.status(204).end();
    res.set("Cache-Control", "no-store").type("image/jpeg").send(jpeg);
  });

  app.post("/connect/input", requireViewer, express.json({ limit: "4kb" }), async (req, res) => {
    const input = req.body as LoginInput;
    if (!input || !["click", "text", "key", "wheel"].includes(input.type)) return void res.status(400).json({ error: "Unknown input" });
    await sessionOf(res).loginInput(input).catch((err) => log(`input failed: ${(err as Error).message}`));
    res.status(204).end();
  });

  app.post("/connect/restart", requireViewer, async (_req, res) => {
    await sessionOf(res).restartLogin().catch((err) => log(`restart failed: ${(err as Error).message}`));
    res.status(204).end();
  });

  app.get("/connect/status", requireViewer, async (_req, res) => {
    const session = sessionOf(res);
    const s = await session.status().catch(() => ({ loggedIn: false }));
    const qr = s.loggedIn ? false : await session.loginWantsQr().catch(() => false);
    res.set("Cache-Control", "no-store").json({ loggedIn: s.loggedIn, qr });
  });

  // The dashboard (dashboard.ts): the saved copy, part by part, and a button to fetch it again.
  app.get("/dashboard", (_req, res) => void res.redirect(303, "/connect/record"));
  async function dashboardInput(copy: SavedCopy): Promise<DashboardInput> {
    const s = await copy.session.status().catch(() => ({ loggedIn: false }));
    return { snapshot: copy.saved(), loggedIn: s.loggedIn, refreshing: copy.isRunning(), sync: asOwner(copy, syncStatus), apiUrl: new URL("/api/v1", baseUrl).href, renewal: config.allowRenewal };
  }

  // Prescription renewal, live against the viewer's session: the one write to sundhed.dk (renewal.ts).
  if (config.allowRenewal) {
    // The viewer's copy, or the sign-in (answered here) when there is none.
    const renewalViewer = async (req: express.Request, res: express.Response): Promise<SavedCopy | null> => {
      if (setupProblems().length || (!multi && !passwordConfigured())) {
        res.redirect(303, "/");
        return null;
      }
      const copy = await viewerCopy(req).catch(() => null);
      if (copy) return copy;
      if (multi) res.redirect(303, "/connect/login");
      else res.type("html").send(connectSignInPage(langOf(req)));
      return null;
    };
    // What the person is told when a renewal call fails. Drug names stay out of the log.
    const renewalFailure = (err: unknown): string => {
      if (err instanceof SessionGone || err instanceof RenewalError) return err.message;
      log(`renewal failed: ${(err as Error).name}`);
      return (err as Error).message;
    };
    app.get("/connect/record/renewals", async (req, res) => {
      const copy = await renewalViewer(req, res);
      if (!copy) return;
      const lang = langOf(req);
      const s = await copy.session.status().catch(() => ({ loggedIn: false }));
      const auto = { state: await loadAutoRenew(copy), cooldownMs: cooldownMs() };
      const notice = req.query.stopped === "1" ? renewalTexts(lang).stopped : undefined;
      let page: string;
      if (!s.loggedIn) page = renewalsPage(lang, { loggedIn: false, auto, notice });
      else {
        try {
          page = renewalsPage(lang, { loggedIn: true, overview: await asOwner(copy, () => renewalOverview()), auto, notice });
        } catch (err) {
          page = renewalsPage(lang, { loggedIn: true, error: renewalFailure(err), auto, notice });
        }
      }
      res.set("Cache-Control", "no-store").type("html").send(page);
    });
    app.get("/connect/record/renewals/:id", async (req, res) => {
      const copy = await renewalViewer(req, res);
      if (!copy) return;
      const lang = langOf(req);
      let page: string;
      try {
        page = renewalFormPage(lang, await asOwner(copy, () => renewalChoices(String(req.params.id))), undefined, cooldownMs());
      } catch (err) {
        page = renewalResultPage(lang, { error: renewalFailure(err) });
      }
      res.set("Cache-Control", "no-store").type("html").send(page);
    });
    app.post("/connect/record/renewals", requireViewer, express.urlencoded({ extended: false, limit: "4kb" }), async (req, res) => {
      const copy = await viewerCopy(req);
      if (!copy) return void res.redirect(303, "/connect/record/renewals");
      const lang = langOf(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = String(body.id ?? "");
      let page: string;
      try {
        if (body.confirm !== "1") {
          page = renewalFormPage(lang, await asOwner(copy, () => renewalChoices(id)), renewalTexts(lang).mustConfirm, cooldownMs());
        } else {
          const r = await asOwner(copy, () => sendRenewal({ id, packageNumber: String(body.packageNumber ?? ""), quantity: Number(body.quantity) }));
          // Auto-renew asks for the same again later (auto-renew.ts); the rule is made only from a renewal just sent.
          const auto = body.auto === "1";
          if (auto) {
            await addRule(copy, { id: r.medicine.id, drug: r.medicine.drug, ...(r.medicine.strength ? { strength: r.medicine.strength } : {}), packageNumber: r.package.number, packageText: r.package.text, quantity: r.quantity });
          }
          page = renewalResultPage(lang, { drug: r.medicine.drug, pkg: r.package.text, quantity: r.quantity, ...(auto ? { autoCooldownMs: cooldownMs() } : {}) });
        }
      } catch (err) {
        page = renewalResultPage(lang, { error: renewalFailure(err) });
      }
      res.set("Cache-Control", "no-store").type("html").send(page);
    });
    app.post(AUTO_STOP, requireViewer, express.urlencoded({ extended: false, limit: "1kb" }), async (req, res) => {
      const copy = await viewerCopy(req);
      if (copy) await stopRule(copy, String((req.body as Record<string, unknown> | undefined)?.id ?? ""));
      res.redirect(303, `/connect/record/renewals${copy ? "?stopped=1" : ""}`);
    });
  }
  app.get(["/connect/record", "/connect/record/:part"], async (req, res) => {
    if (setupProblems().length || (!multi && !passwordConfigured())) return void res.redirect(303, "/");
    const part = req.params.part === undefined ? null : partOfSlug(String(req.params.part));
    if (part === undefined) return void res.status(404).type("text").send("Not found");
    const copy = await viewerCopy(req).catch(() => null);
    if (!copy) {
      if (multi) return void res.redirect(303, "/connect/login");
      return void res.type("html").send(connectSignInPage(langOf(req)));
    }
    const input = await dashboardInput(copy);
    res
      .set("Cache-Control", "no-store")
      .type("html")
      .send(part ? partPage(langOf(req), part, input) : dashboardPage(langOf(req), input));
  });

  app.post("/connect/record/refresh", requireViewer, express.urlencoded({ extended: false, limit: "4kb" }), async (req, res) => {
    const asked = String((req.body as Record<string, unknown> | undefined)?.part ?? "");
    const part = PART_NAMES.find((p) => p === asked);
    const copy = await viewerCopy(req);
    const s = await copy?.session.status().catch(() => ({ loggedIn: false }));
    if (copy && s?.loggedIn) copy.refresh(part ? [part] : undefined).catch((err: unknown) => log(`refresh failed: ${(err as Error).message}`));
    res.redirect(303, part ? `/connect/record/${PART_SLUGS[part]}` : "/connect/record");
  });

  // --- OAuth server for the MCP connector (single user) ---

  if (!multi) {
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
  }

  // --- MCP endpoint (stateless: one transport per request; the sundhed.dk session is process-wide) ---

  let bearer: express.RequestHandler;
  let apiAuth: express.RequestHandler;
  if (multi) {
    // The identity provider is the authorization server; this only says where it is.
    const metadataUrl = getOAuthProtectedResourceMetadataUrl(mcpUrl);
    const metadata = protectedResourceMetadata(multi.oidc, mcpUrl.href);
    app.get(["/.well-known/oauth-protected-resource", new URL(metadataUrl).pathname], (_req, res) => void res.json(metadata));
    const caller = requireCaller(createTokenVerifier(multi.oidc, multi.deps), metadataUrl, log);
    // The caller's own copy into res.locals.copy; `failed` answers when it cannot be opened.
    const withCopy =
      (failed: (res: express.Response) => void): express.RequestHandler =>
      (req, res, next) =>
        caller(req, res, () => {
          multi.users.get(res.locals.caller).then(
            (copy) => {
              res.locals.copy = copy;
              next();
            },
            (err: unknown) => {
              log(`could not open a saved copy: ${(err as Error).message}`);
              failed(res);
            },
          );
        });
    const mcpCopy = withCopy((res) => void res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
    bearer = (req, res, next) => {
      // Runs outside anyone's session; onlyListsTools lets no tool call through.
      if (multi.oidc.anonymousToolList && !req.headers.authorization && onlyListsTools(req.body)) return next();
      mcpCopy(req, res, next);
    };
    const apiCopy = withCopy((res) => void res.status(500).json({ error: "internal_error" }));
    apiAuth = (req, res, next) =>
      apiCopy(req, res, () => {
        const scopes = (res.locals.caller as { scopes: string[] }).scopes;
        res.locals.api = { copy: res.locals.copy, canWrite: !config.apiWriteScope || scopes.includes(config.apiWriteScope) } satisfies ApiCaller;
        next();
      });
  } else {
    bearer = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });
    // One person: every valid token is the owner's, and may change things too.
    apiAuth = (req, res, next) =>
      bearer(req, res, () => {
        res.locals.api = { copy: defaultCopy, canWrite: true } satisfies ApiCaller;
        next();
      });
  }
  mountApi(app, { auth: apiAuth, writeScope: multi ? config.apiWriteScope : "", renewal: config.allowRenewal, log });

  // With several people the body is read first, to see if it only lists tools.
  const json = express.json({ limit: "1mb" });
  app.post(["/mcp", "/"], ...(multi ? [json, bearer] : [bearer, json]), (req: express.Request, res: express.Response) => {
    const copy = res.locals.copy as SavedCopy | undefined;
    return copy ? asOwner(copy, () => handleMcp(req, res)) : handleMcp(req, res);
  });
  async function handleMcp(req: express.Request, res: express.Response): Promise<void> {
    // With several people, only a token with the write scope may renew prescriptions.
    const scopes = (res.locals.caller as { scopes?: string[] } | undefined)?.scopes ?? [];
    const server = createServer({ canWrite: !multi || !config.apiWriteScope || scopes.includes(config.apiWriteScope) });
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
  }
  app.get("/mcp", bearer, (_req, res) => void res.status(405).set("Allow", "POST").json({ error: "This server is stateless; use POST." }));
  app.delete("/mcp", bearer, (_req, res) => void res.status(405).set("Allow", "POST").json({ error: "This server is stateless; use POST." }));

  return app;
}
