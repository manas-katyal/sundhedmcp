import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

// config.ts reads the environment when it is first imported.
const dataDir = mkdtempSync(join(tmpdir(), "sundhedmcp-api-"));
const API_TOKEN = "test-api-token-0123456789abcdefghijklmnop";
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
process.env.SUNDHEDMCP_API_TOKENS = API_TOKEN;
delete process.env.SUNDHEDMCP_API_WRITE_SCOPE;

const ISSUER = "https://idp.example.test/realms/test";
const oidc = { issuer: ISSUER, audience: "sundhedmcp", acceptIdTokens: false, anonymousToolList: false, clientId: "sundhedmcp-connect" };

const { privateKey, publicKey } = await generateKeyPair("RS256");
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" }] });
const sign = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience("sundhedmcp").setIssuedAt().setExpirationTime("5m").sign(privateKey);

// The identity provider for the /connect sign-in.
const nonces = new Map<string, string>();
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === `${ISSUER}/.well-known/openid-configuration`) {
    return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/certs` });
  }
  if (url === `${ISSUER}/token`) {
    const [sub, state] = String(new URLSearchParams(String(init?.body)).get("code")).split(":");
    const idToken = await new SignJWT({ sub, nonce: nonces.get(state as string) })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(ISSUER)
      .setAudience("sundhedmcp-connect")
      .setExpirationTime("5m")
      .sign(privateKey);
    return Response.json({ id_token: idToken });
  }
  return new Response("not found", { status: 404 });
};

// Made-up data in the shape of a saved copy; none of it is real.
const fakeSnapshot = () => ({
  savedAt: "2026-01-02T10:00:00.000Z",
  fetchedAt: { medicationCard: "2026-01-02T10:00:00.000Z", summary: "2026-01-02T10:00:00.000Z" },
  summary: { name: "Test Person", note: "<script>alert(1)</script>" },
  medicationCard: [{ OrdinationId: "ord-1", Drug: "Testamol 500 mg", Dose: "1 tablet" }],
  medicationDetails: { "ord-1": { OrdinationId: "ord-1", Drug: "Testamol 500 mg", Reason: "Made up" } },
  prescriptionDetails: {},
  vaccinationDetails: {},
  errors: { prescriptions: "Made-up failure" },
});

let multiServer: Server;
let singleServer: Server;
let multiBase = "";
let singleBase = "";
let users: import("../src/users.ts").Users;

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};

before(async () => {
  const { createApp } = await import("../src/app.ts");
  const { Users } = await import("../src/users.ts");
  const { config } = await import("../src/config.ts");
  users = new Users(null);
  multiServer = createServer();
  singleServer = createServer();
  multiBase = await listen(multiServer);
  singleBase = await listen(singleServer);
  config.baseUrl = multiBase;
  multiServer.on("request", createApp(undefined, { oidc, users, deps: { keys, fetch: fakeFetch } }));
  singleServer.on("request", createApp());
  Object.assign(await users.get({ issuer: ISSUER, sub: "alice" }), { current: fakeSnapshot() });
});

after(() => {
  multiServer.close();
  singleServer.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const api = async (path: string, opts: { sub?: string; scope?: string; method?: string; body?: unknown } = {}) =>
  fetch(`${multiBase}/api/v1${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.sub ? { authorization: `Bearer ${await sign({ sub: opts.sub, ...(opts.scope ? { scope: opts.scope } : {}) })}` } : {}),
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

test("the OpenAPI description is public; the data is not", async () => {
  const spec = (await (await fetch(`${multiBase}/api/v1/openapi.json`)).json()) as { paths: Record<string, unknown> };
  assert.ok(spec.paths["/medication-card/{id}"]);
  assert.ok(spec.paths["/refresh"]);
  const res = await api("/status");
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /^Bearer /);
});

test("a person reads their own saved copy", async () => {
  const status = (await (await api("/status", { sub: "alice" })).json()) as { loggedIn: boolean; savedAt: string; errors: Record<string, string> };
  assert.equal(status.loggedIn, false);
  assert.equal(status.savedAt, "2026-01-02T10:00:00.000Z");
  assert.equal(status.errors.prescriptions, "Made-up failure");

  const card = await api("/medication-card", { sub: "alice" });
  assert.equal(card.headers.get("cache-control"), "no-store");
  assert.deepEqual(await card.json(), {
    fetchedAt: "2026-01-02T10:00:00.000Z",
    error: null,
    data: [{ OrdinationId: "ord-1", Drug: "Testamol 500 mg", Dose: "1 tablet" }],
    details: ["ord-1"],
  });
  assert.equal(((await (await api("/medication-card/ord-1", { sub: "alice" })).json()) as { data: { Reason: string } }).data.Reason, "Made up");
  assert.equal((await api("/medication-card/nope", { sub: "alice" })).status, 404);
  assert.equal((await api("/medication-card/a.b", { sub: "alice" })).status, 400);
  const missing = await api("/prescriptions", { sub: "alice" });
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error_description: string }).error_description, "Made-up failure");
  assert.equal((await api("/nothing-here", { sub: "alice" })).status, 404);
});

test("another person never sees it", async () => {
  assert.equal((await api("/medication-card", { sub: "bob" })).status, 404);
  assert.equal((await api("/medication-card/ord-1", { sub: "bob" })).status, 404);
  assert.equal(((await (await api("/status", { sub: "bob" })).json()) as { savedAt: string | null }).savedAt, null);
});

test("changing calls need the write scope", async () => {
  const denied = await api("/refresh", { sub: "alice", method: "POST" });
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get("www-authenticate") ?? "", /insufficient_scope.*sundhed:write/);
  assert.equal((await api("/saved-copy", { sub: "alice", method: "DELETE" })).status, 403);
  assert.equal((await api("/refresh", { sub: "alice", scope: "openid sundhed:write", method: "POST", body: { parts: ["nope"] } })).status, 400);
  // Not logged in with MitID, so there is nothing to fetch with.
  const refresh = await api("/refresh", { sub: "alice", scope: "sundhed:write", method: "POST", body: { parts: ["summary"] } });
  assert.equal(refresh.status, 409);
});

test("/connect/record shows the signed-in person's copy, escaped", async () => {
  const anonymous = await fetch(`${multiBase}/connect/record`, { redirect: "manual" });
  assert.equal(anonymous.status, 303);
  assert.equal(anonymous.headers.get("location"), "/connect/login");
  const start = await fetch(`${multiBase}/connect/login`, { redirect: "manual" });
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") as string;
  nonces.set(state, new URL(start.headers.get("location") ?? "").searchParams.get("nonce") as string);
  const back = await fetch(`${multiBase}/connect/callback?state=${state}&code=alice:${state}`, {
    redirect: "manual",
    headers: { cookie: (start.headers.get("set-cookie") ?? "").split(";")[0] as string },
  });
  const cookie = (back.headers.getSetCookie().find((c) => c.startsWith("sundhed_user=")) ?? "").split(";")[0] as string;
  const page = await fetch(`${multiBase}/connect/record?lang=en`, { headers: { cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("Testamol 500 mg"));
  assert.ok(html.includes("Made-up failure"));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  const evil = await fetch(`${multiBase}/connect/record/refresh`, { method: "POST", redirect: "manual", headers: { cookie, origin: "https://evil.example.test" } });
  assert.equal(evil.status, 403);
  const ok = await fetch(`${multiBase}/connect/record/refresh`, { method: "POST", redirect: "manual", headers: { cookie, origin: multiBase } });
  assert.equal(ok.status, 303);
});

test("with one person an API token reads and may change things", async () => {
  const get = (path: string, token?: string) => fetch(`${singleBase}/api/v1${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal((await get("/status")).status, 401);
  assert.equal((await get("/status", "wrong-token-0123456789abcdefghijklmnop")).status, 401);
  assert.equal((await get("/status", API_TOKEN)).status, 200);
  assert.equal((await get("/summary", API_TOKEN)).status, 404);
  const del = await fetch(`${singleBase}/api/v1/saved-copy`, { method: "DELETE", headers: { authorization: `Bearer ${API_TOKEN}` } });
  assert.equal(del.status, 204);
});

test("deleting the copy removes it", async () => {
  assert.equal((await api("/saved-copy", { sub: "alice", scope: "sundhed:write", method: "DELETE" })).status, 204);
  assert.equal((await api("/medication-card", { sub: "alice" })).status, 404);
});
