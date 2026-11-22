import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

// config.ts reads the environment when it is first imported.
const dataDir = mkdtempSync(join(tmpdir(), "sundhedmcp-oidc-"));
process.env.DATA_DIR = dataDir;
delete process.env.ADMIN_PASSWORD;

const ISSUER = "https://idp.example.test/realms/test";
const AUDIENCE = "sundhedmcp";
const CLIENT_ID = "sundhedmcp-connect";
const oidc = { issuer: ISSUER, audience: AUDIENCE, acceptIdTokens: false, anonymousToolList: true, clientId: CLIENT_ID };

const { privateKey, publicKey } = await generateKeyPair("RS256");
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" }] });

const sign = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(privateKey);

// The identity provider: discovery, and a token endpoint that answers with an
// ID token for whoever the code names, with the nonce it was given.
const nonces = new Map<string, string>();
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === `${ISSUER}/.well-known/openid-configuration`) {
    return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/certs` });
  }
  if (url === `${ISSUER}/token`) {
    const body = new URLSearchParams(String(init?.body));
    const [sub, state] = String(body.get("code")).split(":");
    if (!body.get("code_verifier")) return new Response("no verifier", { status: 400 });
    return Response.json({ id_token: await sign({ sub, nonce: nonces.get(state as string), name: `Test ${sub}` }, { aud: CLIENT_ID }) });
  }
  return new Response("not found", { status: 404 });
};

let server: Server;
let base = "";
let users: import("../src/users.ts").Users;

before(async () => {
  const { createApp } = await import("../src/app.ts");
  const { Users } = await import("../src/users.ts");
  users = new Users(null);
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const { config } = await import("../src/config.ts");
  config.baseUrl = base;
  server.on("request", createApp(undefined, { oidc, users, deps: { keys, fetch: fakeFetch } }));
});

after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("resolveOidc refuses half-configured multi-user mode", async () => {
  const { resolveOidc } = await import("../src/oidc.ts");
  const full = { SUNDHEDMCP_MULTI_USER: "1", SUNDHEDMCP_OIDC_ISSUER: ISSUER, SUNDHEDMCP_OIDC_AUDIENCE: AUDIENCE, SUNDHEDMCP_OIDC_CLIENT_ID: CLIENT_ID };
  assert.equal(resolveOidc({}, []), null);
  assert.deepEqual(resolveOidc({ ...full, SUNDHEDMCP_ANONYMOUS_TOOL_LIST: "1" }, []), oidc);
  assert.equal(resolveOidc(full, [])?.anonymousToolList, false);
  assert.throws(() => resolveOidc({ SUNDHEDMCP_OIDC_ISSUER: ISSUER }, []), /MULTI_USER is off/);
  assert.throws(() => resolveOidc({ SUNDHEDMCP_MULTI_USER: "1", SUNDHEDMCP_OIDC_ISSUER: ISSUER }, []), /SUNDHEDMCP_OIDC_AUDIENCE, SUNDHEDMCP_OIDC_CLIENT_ID/);
  assert.throws(() => resolveOidc({ ...full, SUNDHEDMCP_OIDC_ISSUER: "http://idp.example.test" }, []), /https/);
  assert.throws(() => resolveOidc(full, ["x".repeat(40)]), /API_TOKENS/);
  assert.throws(() => resolveOidc({ ...full, SUNDHEDMCP_MULTI_USER: "yes" }, []), /must be 1 or 0/);
});

test("the token verifier checks issuer, audience, expiry and token type", async () => {
  const { createTokenVerifier, CallerAuthError } = await import("../src/oidc.ts");
  const verify = createTokenVerifier(oidc, { keys });
  assert.deepEqual(await verify(`Bearer ${await sign({ sub: "alice" })}`), { issuer: ISSUER, sub: "alice" });
  const rejects = async (authorization: string | undefined, code: string) => {
    await assert.rejects(verify(authorization), (err: unknown) => err instanceof CallerAuthError && err.code === code);
  };
  await rejects(undefined, "missing_token");
  await rejects("Basic abc", "missing_token");
  await rejects(`Bearer ${await sign({ sub: "alice" }, { aud: "someone-else" })}`, "invalid_token");
  await rejects(`Bearer ${await sign({ sub: "alice" }, { iss: "https://evil.example.test" })}`, "invalid_token");
  await rejects(`Bearer ${await sign({ sub: "alice" }, { exp: "-5m" })}`, "invalid_token");
  await rejects(`Bearer ${await sign({ sub: "alice", typ: "ID" })}`, "invalid_token");
  const hmac = await new SignJWT({ sub: "alice" }).setProtectedHeader({ alg: "HS256" }).setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime("5m").sign(new Uint8Array(32));
  await rejects(`Bearer ${hmac}`, "invalid_token");
  const lenient = createTokenVerifier({ ...oidc, acceptIdTokens: true }, { keys });
  assert.equal((await lenient(`Bearer ${await sign({ sub: "bob", typ: "ID" })}`)).sub, "bob");
});

test("/mcp asks for a token and points at the identity provider", async () => {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 401);
  const challenge = res.headers.get("www-authenticate") ?? "";
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  assert.ok(metadataUrl, challenge);
  const metadata = (await (await fetch(metadataUrl)).json()) as { authorization_servers: string[]; resource: string };
  assert.deepEqual(metadata.authorization_servers, [ISSUER]);
  assert.equal(metadata.resource, `${base}/mcp`);
  // No OAuth server of its own, and no password.
  assert.equal((await fetch(`${base}/.well-known/oauth-authorization-server`)).status, 404);
  assert.equal((await fetch(`${base}/register`, { method: "POST" })).status, 404);
});

test("/mcp answers a signed-in person", async () => {
  const token = await sign({ sub: "alice" });
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { result?: { serverInfo?: { name: string } } };
  assert.equal(body.result?.serverInfo?.name, "sundhed");
});

test("tools are listed without a token, but never called", async () => {
  const post = (body: unknown) =>
    fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
  const list = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(list.status, 200);
  const tools = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools;
  assert.ok(tools.some((t) => t.name === "get_medication_card"));
  assert.equal((await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_summary", arguments: {} } })).status, 401);
  assert.equal((await post([{ jsonrpc: "2.0", id: 3, method: "tools/list" }, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_summary" } }])).status, 401);
});

/** Signs a browser in at /connect as `sub`, and returns its session cookie. */
async function signIn(sub: string): Promise<string> {
  const start = await fetch(`${base}/connect/login`, { redirect: "manual" });
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get("location") ?? "");
  assert.equal(`${to.origin}${to.pathname}`, `${ISSUER}/auth`);
  assert.equal(to.searchParams.get("code_challenge_method"), "S256");
  assert.equal(to.searchParams.get("redirect_uri"), `${base}/connect/callback`);
  const state = to.searchParams.get("state") as string;
  nonces.set(state, to.searchParams.get("nonce") as string);
  const stateCookie = (start.headers.get("set-cookie") ?? "").split(";")[0] as string;
  const back = await fetch(`${base}/connect/callback?state=${state}&code=${sub}:${state}`, { redirect: "manual", headers: { cookie: stateCookie } });
  assert.equal(back.status, 303);
  const session = back.headers.getSetCookie().find((c) => c.startsWith("sundhed_user="));
  assert.ok(session);
  return session.split(";")[0] as string;
}

test("/connect signs in with the identity provider", async () => {
  const first = await fetch(`${base}/connect`, { redirect: "manual" });
  assert.equal(first.status, 303);
  assert.equal(first.headers.get("location"), "/connect/login");
  assert.equal((await fetch(`${base}/connect/status`)).status, 401);
  const cookie = await signIn("alice");
  const status = await fetch(`${base}/connect/status`, { headers: { cookie } });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { loggedIn: false, qr: false });
  // The password sign-in is not there.
  const legacy = await fetch(`${base}/connect/signin`, { method: "POST", redirect: "manual" });
  assert.equal(legacy.headers.get("location"), "/connect/login");
});

test("a callback from another browser, or replayed, is refused", async () => {
  const start = await fetch(`${base}/connect/login`, { redirect: "manual" });
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") as string;
  const stolen = await fetch(`${base}/connect/callback?state=${state}&code=mallory:${state}`, { redirect: "manual" });
  assert.equal(stolen.status, 400);
  // The state is used up even by the failed try.
  const stateCookie = (start.headers.get("set-cookie") ?? "").split(";")[0] as string;
  const replay = await fetch(`${base}/connect/callback?state=${state}&code=mallory:${state}`, { redirect: "manual", headers: { cookie: stateCookie } });
  assert.equal(replay.status, 400);
});

test("/connect posts from another site are refused", async () => {
  const cookie = await signIn("alice");
  const res = await fetch(`${base}/connect/restart`, { method: "POST", headers: { cookie, origin: "https://evil.example.test" } });
  assert.equal(res.status, 403);
});

test("each person has their own session and saved copy", async () => {
  const { asOwner, saved, currentCopy } = await import("../src/snapshot.ts");
  const { currentSession } = await import("@sundhedmcp/session");
  const alice = await users.get({ issuer: ISSUER, sub: "alice" });
  const bob = await users.get({ issuer: ISSUER, sub: "bob" });
  assert.notEqual(alice, bob);
  assert.notEqual(alice.session, bob.session);
  assert.equal(await users.get({ issuer: ISSUER, sub: "alice" }), alice);
  // The same sub from another issuer is another person.
  assert.notEqual(await users.get({ issuer: "https://other.example.test", sub: "alice" }), alice);
  assert.equal(users.copyOf(bob.session), bob);
  await asOwner(alice, async () => {
    await Promise.resolve();
    assert.equal(currentCopy(), alice);
    assert.equal(currentSession(), alice.session);
    assert.equal(saved(), null);
  });
  assert.notEqual(currentCopy(), alice);
});
