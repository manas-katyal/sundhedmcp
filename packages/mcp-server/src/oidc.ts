// Multi-user hosted mode: everyone signs in with the same identity provider
// (OIDC), and each person gets their own sundhed.dk session and saved copy.
//
// SundhedMCP is then an OAuth resource server for /mcp: it checks the access
// token itself (signature against the issuer's JWKS, `iss`, `aud`, `exp`) and
// takes the person from `sub`. It never trusts an identity a proxy or agent
// runtime asserts. The /connect page signs the person in with the same
// provider (authorization code flow with PKCE), so its MitID login lands in
// the same person's session as their /mcp calls.
//
// Env:
//   SUNDHEDMCP_MULTI_USER=1             turn it on (needs the two below)
//   SUNDHEDMCP_OIDC_ISSUER              must equal the tokens' `iss` exactly
//   SUNDHEDMCP_OIDC_AUDIENCE            must be in the access tokens' `aud`
//   SUNDHEDMCP_OIDC_ACCEPT_ID_TOKEN=1   also accept ID tokens, for fronts that
//                                       forward nothing else; `aud` still applies
//   SUNDHEDMCP_OIDC_CLIENT_ID           the /connect page's OIDC client
//   SUNDHEDMCP_OIDC_CLIENT_SECRET       its secret, unless it is a public client
//   SUNDHEDMCP_ANONYMOUS_TOOL_LIST=1    answer initialize and tools/list without
//                                       a token, for clients that list tools
//                                       before anyone signs in (kagent)
//
// Every half-configured state stops the server: a typo must never leave
// someone believing sign-in is required when it is not.
import { createHash, randomBytes } from "node:crypto";
import type express from "express";
import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";

/** Asymmetric algorithms only; an HMAC token would mean a shared secret. */
export const ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "EdDSA"];

export interface OidcConfig {
  issuer: string;
  audience: string;
  acceptIdTokens: boolean;
  /** initialize and tools/list answer without a token; tool calls never do. */
  anonymousToolList: boolean;
  /** The /connect page's client. */
  clientId: string;
  clientSecret?: string;
}

export class OidcConfigError extends Error {
  override name = "OidcConfigError";
}

/** The OIDC settings, or null in single-user mode. Throws on anything half set. */
export function resolveOidc(env: NodeJS.ProcessEnv, apiTokens: string[]): OidcConfig | null {
  const flag = env.SUNDHEDMCP_MULTI_USER?.trim() ?? "";
  const issuer = env.SUNDHEDMCP_OIDC_ISSUER?.trim() ?? "";
  const audience = env.SUNDHEDMCP_OIDC_AUDIENCE?.trim() ?? "";
  const acceptIdToken = env.SUNDHEDMCP_OIDC_ACCEPT_ID_TOKEN?.trim() ?? "";
  const clientId = env.SUNDHEDMCP_OIDC_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.SUNDHEDMCP_OIDC_CLIENT_SECRET ?? "";
  const anonymousToolList = env.SUNDHEDMCP_ANONYMOUS_TOOL_LIST?.trim() ?? "";
  if (flag === "" || flag === "0") {
    if (issuer || audience || acceptIdToken || clientId || clientSecret || anonymousToolList) {
      throw new OidcConfigError("SUNDHEDMCP_OIDC_* settings are set but SUNDHEDMCP_MULTI_USER is off. Set SUNDHEDMCP_MULTI_USER=1, or remove them.");
    }
    return null;
  }
  if (flag !== "1") throw new OidcConfigError(`SUNDHEDMCP_MULTI_USER must be 1 or 0, not "${flag}".`);
  for (const [name, value] of [
    ["SUNDHEDMCP_OIDC_ACCEPT_ID_TOKEN", acceptIdToken],
    ["SUNDHEDMCP_ANONYMOUS_TOOL_LIST", anonymousToolList],
  ]) {
    if (!["", "0", "1"].includes(value as string)) throw new OidcConfigError(`${name} must be 1 or 0, not "${value}".`);
  }
  const missing = [
    ["SUNDHEDMCP_OIDC_ISSUER", issuer],
    ["SUNDHEDMCP_OIDC_AUDIENCE", audience],
    ["SUNDHEDMCP_OIDC_CLIENT_ID", clientId],
  ].flatMap(([name, value]) => (value ? [] : [name]));
  if (missing.length) throw new OidcConfigError(`SUNDHEDMCP_MULTI_USER=1 needs ${missing.join(", ")}.`);
  // A static token is no person, so it cannot pick whose record it reads.
  if (apiTokens.length) throw new OidcConfigError("SUNDHEDMCP_API_TOKENS cannot be used with SUNDHEDMCP_MULTI_USER=1: every call must come from a signed-in person.");
  // The signing keys are fetched from the issuer, so plain HTTP would let
  // anyone on the path swap them. Loopback is allowed for local testing.
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new OidcConfigError(`SUNDHEDMCP_OIDC_ISSUER is not a URL: "${issuer}".`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new OidcConfigError(`SUNDHEDMCP_OIDC_ISSUER must use https (http only on localhost), not "${issuer}".`);
  }
  return { issuer, audience, acceptIdTokens: acceptIdToken === "1", anonymousToolList: anonymousToolList === "1", clientId, ...(clientSecret ? { clientSecret } : {}) };
}

/** The signed-in person behind a request. */
export interface Caller {
  issuer: string;
  sub: string;
  /** The token's space-separated `scope` claim; an ID token has none. */
  scopes: string[];
}

/**
 * Stable id for a person: their storage owner id. Includes the issuer, so a
 * new identity provider never maps a new person onto an old person's record.
 */
export function callerId(caller: Pick<Caller, "issuer" | "sub">): string {
  return createHash("sha256").update(`${caller.issuer}\n${caller.sub}`).digest("hex").slice(0, 32);
}

/** The request carried no usable token: 401. */
export class CallerAuthError extends Error {
  override name = "CallerAuthError";
  readonly code: "missing_token" | "invalid_token";

  constructor(code: "missing_token" | "invalid_token", message: string) {
    super(message);
    this.code = code;
  }
}

interface Provider {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  endSessionEndpoint?: string;
  keys: JWTVerifyGetKey;
}

export interface OidcDeps {
  /** Key lookup instead of the issuer's JWKS (tests). */
  keys?: JWTVerifyGetKey;
  fetch?: typeof fetch;
}

/** The provider's endpoints and keys, discovered once; a failure is tried again next time. */
function discovery(issuer: string, deps: OidcDeps): () => Promise<Provider> {
  let found: Promise<Provider> | undefined;
  return () => {
    found ??= discover(issuer, deps).catch((err: unknown) => {
      found = undefined;
      throw err;
    });
    return found;
  };
}

async function discover(issuer: string, deps: OidcDeps): Promise<Provider> {
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const res = await (deps.fetch ?? fetch)(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${url} answered ${res.status}`);
  const doc = (await res.json()) as Record<string, unknown>;
  if (doc.issuer !== issuer) throw new Error(`OIDC discovery issuer mismatch: configured "${issuer}", the provider says "${String(doc.issuer)}"`);
  const { authorization_endpoint, token_endpoint, jwks_uri, end_session_endpoint } = doc;
  if (typeof authorization_endpoint !== "string" || typeof token_endpoint !== "string") throw new Error("OIDC discovery has no authorization or token endpoint");
  if (!deps.keys && typeof jwks_uri !== "string") throw new Error("OIDC discovery has no jwks_uri");
  return {
    authorizationEndpoint: authorization_endpoint,
    tokenEndpoint: token_endpoint,
    ...(typeof end_session_endpoint === "string" ? { endSessionEndpoint: end_session_endpoint } : {}),
    keys: deps.keys ?? createRemoteJWKSet(new URL(jwks_uri as string)),
  };
}

/** Checks the bearer token of an /mcp request. Throws CallerAuthError for a bad token, anything else when the provider is unreachable. */
export function createTokenVerifier(oidc: OidcConfig, deps: OidcDeps = {}): (authorization: string | undefined) => Promise<Caller> {
  const keys = deps.keys ? () => Promise.resolve(deps.keys as JWTVerifyGetKey) : async () => (await discovery(oidc.issuer, deps)()).keys;
  return async (authorization) => {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
    if (!match?.[1]) throw new CallerAuthError("missing_token", "Missing bearer token.");
    const getKey = await keys();
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(match[1], getKey, {
        issuer: oidc.issuer,
        audience: oidc.audience,
        algorithms: ALGORITHMS,
        requiredClaims: ["sub", "exp"],
        clockTolerance: 30,
      }));
    } catch (err) {
      if (err instanceof errors.JOSEError) throw new CallerAuthError("invalid_token", "Invalid or expired token.");
      throw err;
    }
    // Keycloak marks ID tokens with typ "ID". One issued to this client
    // passes the audience check, but it is not an access token.
    if (payload.typ === "ID" && !oidc.acceptIdTokens) throw new CallerAuthError("invalid_token", "An ID token is not an access token.");
    if (typeof payload.sub !== "string" || payload.sub === "") throw new CallerAuthError("invalid_token", "The token has no subject.");
    const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
    return { issuer: oidc.issuer, sub: payload.sub, scopes };
  };
}

/** The JSON-RPC methods that may come without a token: none of them reads the record. */
const ANONYMOUS_METHODS = new Set(["initialize", "notifications/initialized", "ping", "tools/list"]);

/** Whether a parsed /mcp body only lists tools (anonymousToolList). */
export function onlyListsTools(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.length > 0 && messages.every((m) => typeof m === "object" && m !== null && ANONYMOUS_METHODS.has((m as { method?: unknown }).method as string));
}

/** RFC 9728 protected resource metadata, so MCP clients find the identity provider. */
export const protectedResourceMetadata = (oidc: OidcConfig, resource: string) => ({
  resource,
  authorization_servers: [oidc.issuer],
  bearer_methods_supported: ["header"],
  scopes_supported: ["openid"],
});

/** Express middleware for /mcp: sets res.locals.caller, or answers 401 (bad token) or 503 (provider unreachable). */
export function requireCaller(verify: ReturnType<typeof createTokenVerifier>, metadataUrl: string, log: (msg: string) => void): express.RequestHandler {
  return (req, res, next) => {
    verify(req.headers.authorization).then(
      (caller) => {
        res.locals.caller = caller;
        next();
      },
      (err: unknown) => {
        if (err instanceof CallerAuthError) {
          const challenge =
            err.code === "missing_token"
              ? `Bearer resource_metadata="${metadataUrl}"`
              : `Bearer error="invalid_token", error_description="${err.message}", resource_metadata="${metadataUrl}"`;
          return void res.status(401).set("WWW-Authenticate", challenge).json({ error: err.code, error_description: err.message });
        }
        log(`could not verify a token: ${(err as Error).message}`);
        res.status(503).json({ error: "identity_provider_unavailable", error_description: "Could not verify the token right now." });
      },
    );
  };
}

// --- /connect sign-in: authorization code flow with PKCE ---

const SESSION_TTL_MS = 30 * 60_000;
const PENDING_TTL_MS = 10 * 60_000;
/** A flood of sign-in starts must not grow memory without bound. */
const MAX_PENDING = 1000;

interface Pending {
  verifier: string;
  nonce: string;
  expiresAt: number;
}

interface Session {
  caller: Caller;
  /** For display only. */
  name: string;
  expiresAt: number;
}

export interface ConnectSignIn {
  /** Adds /connect/login, /connect/callback and /connect/logout. */
  mount(app: express.Express): void;
  /** Who this browser is signed in as, or null. */
  signedIn(req: express.Request): { caller: Caller; name: string } | null;
}

const randomToken = () => randomBytes(32).toString("base64url");
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function cookie(req: express.Request, name: string): string | undefined {
  const found = String(req.headers.cookie ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`));
  return found?.slice(name.length + 1);
}

/**
 * Signs a browser in at /connect with the identity provider. Sessions live in
 * memory and expire after 30 minutes, like the single-user viewer session: a
 * restart only costs a redirect. The state cookie ties a callback to the
 * browser that started the sign-in, so nobody can sign someone else's
 * browser in to their own account.
 */
export function createConnectSignIn(oidc: OidcConfig, baseUrl: URL, log: (msg: string) => void, deps: OidcDeps = {}): ConnectSignIn {
  const provider = discovery(oidc.issuer, deps);
  const redirectUri = new URL("/connect/callback", baseUrl).href;
  const secure = baseUrl.protocol === "https:" ? "; Secure" : "";
  // Lax, not Strict: the callback is a navigation coming back from the provider.
  const set = (name: string, value: string, maxAgeMs: number) => `${name}=${value}; Path=/connect; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
  const SESSION = "sundhed_user";
  const STATE = "sundhed_signin";
  const pending = new Map<string, Pending>();
  const sessions = new Map<string, Session>();
  const key = (id: string) => createHash("sha256").update(id).digest("hex");

  function sweep(now: number): void {
    for (const [state, entry] of pending) if (entry.expiresAt <= now) pending.delete(state);
    for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
  }

  const failed = (res: express.Response, status: number, message: string) => void res.status(status).type("text/plain").send(message);

  async function tokenRequest(idp: Provider, params: Record<string, string>): Promise<Record<string, unknown> | null> {
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    if (oidc.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(oidc.clientId)}:${encodeURIComponent(oidc.clientSecret)}`).toString("base64")}`;
    const res = await (deps.fetch ?? fetch)(idp.tokenEndpoint, { method: "POST", headers, body: new URLSearchParams({ ...params, client_id: oidc.clientId }) });
    if (!res.ok) {
      // The OAuth error code and its description say why (a wrong client secret, an expired code), never anything about the person.
      const body = (await res.json().catch(() => null)) as { error?: unknown; error_description?: unknown } | null;
      const why = [body?.error, body?.error_description].filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 200));
      log(`the identity provider refused the sign-in code (${res.status}${why.length ? `: ${why.join(": ")}` : ""})`);
      return null;
    }
    const json = (await res.json().catch(() => null)) as unknown;
    return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  }

  function mount(app: express.Express): void {
    app.get("/connect/login", async (_req, res) => {
      let idp: Provider;
      try {
        idp = await provider();
      } catch (err) {
        log(`identity provider unreachable: ${(err as Error).message}`);
        return failed(res, 503, "The identity provider cannot be reached right now. Try again shortly.");
      }
      const now = Date.now();
      sweep(now);
      if (pending.size >= MAX_PENDING) return failed(res, 503, "Too many sign-ins in progress. Try again shortly.");
      const state = randomToken();
      const verifier = randomToken();
      const nonce = randomToken();
      pending.set(state, { verifier, nonce, expiresAt: now + PENDING_TTL_MS });
      const url = new URL(idp.authorizationEndpoint);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: oidc.clientId,
        redirect_uri: redirectUri,
        scope: "openid profile",
        state,
        nonce,
        code_challenge: s256(verifier),
        code_challenge_method: "S256",
      }).toString();
      res.set("Set-Cookie", set(STATE, state, PENDING_TTL_MS)).redirect(302, url.href);
    });

    app.get("/connect/callback", async (req, res) => {
      const state = String(req.query.state ?? "");
      const entry = state ? pending.get(state) : undefined;
      if (state) pending.delete(state);
      res.set("Set-Cookie", set(STATE, "", 0));
      if (!entry || cookie(req, STATE) !== state || entry.expiresAt <= Date.now()) return failed(res, 400, "This sign-in has expired or was started in another browser. Open /connect again.");
      if (req.query.error) return failed(res, 400, `Sign-in failed: ${String(req.query.error).slice(0, 100)}`);
      const code = String(req.query.code ?? "");
      if (!code) return failed(res, 400, "Sign-in failed: no code.");
      let idp: Provider;
      try {
        idp = await provider();
      } catch (err) {
        log(`identity provider unreachable: ${(err as Error).message}`);
        return failed(res, 503, "The identity provider cannot be reached right now. Try again shortly.");
      }
      const grant = await tokenRequest(idp, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: entry.verifier });
      const idToken = typeof grant?.id_token === "string" ? grant.id_token : null;
      if (!idToken) return failed(res, 400, "Sign-in failed: the code was not accepted.");
      let claims: Record<string, unknown>;
      try {
        ({ payload: claims } = await jwtVerify(idToken, idp.keys, {
          issuer: oidc.issuer,
          audience: oidc.clientId,
          algorithms: ALGORITHMS,
          requiredClaims: ["sub", "exp"],
          clockTolerance: 30,
        }));
      } catch (err) {
        if (!(err instanceof errors.JOSEError)) throw err;
        log(`rejected an ID token: ${err.message}`);
        return failed(res, 400, "Sign-in failed: the ID token was not valid.");
      }
      const sub = claims.sub;
      if (claims.nonce !== entry.nonce || typeof sub !== "string" || sub === "" || (claims.azp !== undefined && claims.azp !== oidc.clientId)) {
        return failed(res, 400, "Sign-in failed: the ID token was not valid.");
      }
      const id = randomToken();
      const name = [claims.name, claims.preferred_username].find((v): v is string => typeof v === "string" && v !== "") ?? sub;
      sessions.set(key(id), { caller: { issuer: oidc.issuer, sub, scopes: [] }, name, expiresAt: Date.now() + SESSION_TTL_MS });
      res.append("Set-Cookie", set(SESSION, id, SESSION_TTL_MS)).redirect(303, "/connect");
    });

    app.post("/connect/logout", async (req, res) => {
      const id = cookie(req, SESSION);
      if (id) sessions.delete(key(id));
      res.set("Set-Cookie", set(SESSION, "", 0));
      let target = new URL("/", baseUrl).href;
      try {
        const { endSessionEndpoint } = await provider();
        if (endSessionEndpoint) {
          const url = new URL(endSessionEndpoint);
          url.search = new URLSearchParams({ client_id: oidc.clientId, post_logout_redirect_uri: target }).toString();
          target = url.href;
        }
      } catch {
        // Signed out here either way.
      }
      res.redirect(303, target);
    });
  }

  function signedIn(req: express.Request) {
    const id = cookie(req, SESSION);
    const session = id ? sessions.get(key(id)) : undefined;
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(key(id as string));
      return null;
    }
    return { caller: session.caller, name: session.name };
  }

  return { mount, signedIn };
}
