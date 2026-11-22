import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { RenewalClient } from "../src/renewal.ts";

// config.ts reads the environment when it is first imported.
const dataDir = mkdtempSync(join(tmpdir(), "sundhedmcp-renewal-"));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
process.env.SUNDHEDMCP_ALLOW_RENEWAL = "1";
delete process.env.SUNDHEDMCP_API_WRITE_SCOPE;

const { MAX_QUANTITY, RenewalError, renewalChoices, renewalOverview, sendRenewal } = await import("../src/renewal.ts");

// Made-up medicine in the shape sundhed.dk's renewal page reads; none of it is real.
function fakeClient(overrides: { hasDoctor?: boolean; version?: number } = {}) {
  const sent: unknown[] = [];
  let version = overrides.version ?? 7;
  const client: RenewalClient = {
    renewable: async () => ({
      HasDoctor: overrides.hasDoctor ?? true,
      MedicineCardVersion: version,
      List: [
        { Id: 101, Status: 0, Drug: "Testamol", Form: "tabletter", Strength: "500 mg", HasWriteAccess: true },
        { Id: 102, Status: 1, Drug: "Privatin" },
        { Id: 103, Status: 4, Drug: "Igangin" },
        { Id: 104, Status: 6, Drug: "Dosisol" },
        { Id: 105, Status: 0, Drug: "Laesbar", HasWriteAccess: false },
      ],
    }),
    renewalPackages: async (id) => {
      assert.equal(id, "101");
      return { DefaultPackageNumber: 222, Packages: [{ Varenummer: 111, Tekst: "20 stk." }, { Varenummer: 222, Tekst: "100 stk." }] };
    },
    renewalRequests: async () => [{ Id: "r-1", Status: "Unprescribed" }],
    requestRenewal: async (r) => {
      sent.push(r);
      return null;
    },
  };
  return { client, sent, bump: () => version++ };
}

test("the overview says which medicine can be renewed and why the rest cannot", async () => {
  const { client } = fakeClient();
  const o = await renewalOverview(client);
  assert.equal(o.hasDoctor, true);
  // Rows being handled are left out, as on sundhed.dk.
  assert.deepEqual(o.medicines.map((m) => m.id), ["101", "102", "104", "105"]);
  assert.deepEqual(o.medicines.map((m) => m.renewable), [true, false, false, false]);
  assert.match(o.medicines[1]?.reason ?? "", /private-marked/);
  assert.match(o.medicines[2]?.reason ?? "", /dose-dispensed/);
  assert.match(o.medicines[3]?.reason ?? "", /not ask for renewals/);
  assert.deepEqual(o.requests, [{ Id: "r-1", Status: "Unprescribed" }]);

  const noGp = await renewalOverview(fakeClient({ hasDoctor: false }).client);
  assert.ok(noGp.medicines.every((m) => !m.renewable && /No GP/.test(m.reason ?? "")));
});

test("the choices are the packages sundhed.dk offers, with its default", async () => {
  const c = await renewalChoices("101", fakeClient().client);
  assert.deepEqual(c.packages, [{ number: "111", text: "20 stk." }, { number: "222", text: "100 stk." }]);
  assert.equal(c.defaultPackage, "222");
  assert.equal(c.maxQuantity, MAX_QUANTITY);
  await assert.rejects(renewalChoices("102", fakeClient().client), (e) => e instanceof RenewalError && e.code === "not_renewable");
  await assert.rejects(renewalChoices("999", fakeClient().client), (e) => e instanceof RenewalError && e.code === "not_found");
});

test("a renewal is checked against the medicine card as it is now, and sent with sundhed.dk's own ids", async () => {
  const { client, sent, bump } = fakeClient();
  bump();
  const r = await sendRenewal({ id: "101", packageNumber: "111", quantity: 2 }, client);
  assert.equal(r.sent, true);
  assert.equal(r.package.text, "20 stk.");
  // The ids go back as numbers, as sundhed.dk gave them, with the newest card version.
  assert.deepEqual(sent, [{ drugMedicationId: 101, medicineCardVersion: 8, packageNumber: 111, quantity: 2 }]);
});

test("a renewal that cannot be asked for is never sent", async () => {
  const { client, sent } = fakeClient();
  const refused = (code: string) => (e: unknown) => e instanceof RenewalError && e.code === code;
  await assert.rejects(sendRenewal({ id: "101", packageNumber: "333", quantity: 1 }, client), refused("invalid_package"));
  for (const quantity of [0, 11, 1.5, Number.NaN]) await assert.rejects(sendRenewal({ id: "101", packageNumber: "111", quantity }, client), refused("invalid_quantity"));
  await assert.rejects(sendRenewal({ id: "102", packageNumber: "111", quantity: 1 }, client), refused("not_renewable"));
  await assert.rejects(sendRenewal({ id: "105", packageNumber: "111", quantity: 1 }, client), refused("not_renewable"));
  await assert.rejects(sendRenewal({ id: "103", packageNumber: "111", quantity: 1 }, client), refused("not_found"));
  assert.deepEqual(sent, []);
});

// --- Through the server, with several people: no browser is started, so the session is never logged in ---

const ISSUER = "https://idp.example.test/realms/test";
const oidc = { issuer: ISSUER, audience: "sundhedmcp", acceptIdTokens: false, anonymousToolList: false, clientId: "sundhedmcp-connect" };
const { privateKey, publicKey } = await generateKeyPair("RS256");
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" }] });
const sign = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience("sundhedmcp").setIssuedAt().setExpirationTime("5m").sign(privateKey);
const noFetch: typeof fetch = async () => new Response("not found", { status: 404 });

let server: Server;
let base = "";

before(async () => {
  const { createApp } = await import("../src/app.ts");
  const { Users } = await import("../src/users.ts");
  const { config } = await import("../src/config.ts");
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  config.baseUrl = base;
  server.on("request", createApp(undefined, { oidc, users: new Users(null), deps: { keys, fetch: noFetch } }));
});

after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const api = async (path: string, opts: { scope?: string; body?: unknown } = {}) =>
  fetch(`${base}/api/v1${path}`, {
    method: opts.body ? "POST" : "GET",
    headers: { authorization: `Bearer ${await sign({ sub: "alice", ...(opts.scope ? { scope: opts.scope } : {}) })}`, ...(opts.body ? { "content-type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

test("the API renews only with the write scope, and only while logged in", async () => {
  const spec = (await (await fetch(`${base}/api/v1/openapi.json`)).json()) as { paths: Record<string, unknown> };
  assert.ok(spec.paths["/renewals"]);
  const request = { id: "101", packageNumber: "111", quantity: 1 };
  assert.equal((await api("/renewals", { body: request })).status, 403);
  assert.equal((await api("/renewals", { scope: "openid sundhed:write", body: { ...request, id: "../x" } })).status, 400);
  const notLoggedIn = await api("/renewals", { scope: "openid sundhed:write", body: request });
  assert.equal(notLoggedIn.status, 409);
  assert.equal(((await notLoggedIn.json()) as { error: string }).error, "not_logged_in");
  assert.equal((await api("/renewals")).status, 409);
  assert.equal((await api("/renewals/..")).status, 404);
});

test("the MCP tool refuses a caller without the write scope", async () => {
  const call = async (scope?: string) => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${await sign({ sub: "alice", ...(scope ? { scope } : {}) })}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "renew_prescription", arguments: { id: "101", packageNumber: "111", quantity: 1, confirm: true } } }),
    });
    return ((await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
  };
  const readOnly = await call();
  assert.equal(readOnly.isError, true);
  assert.match(readOnly.content[0]?.text ?? "", /may only read/);
  // With the scope it gets as far as sundhed.dk, which needs a login.
  const withScope = await call("sundhed:write");
  assert.equal(withScope.isError, true);
  assert.doesNotMatch(withScope.content[0]?.text ?? "", /may only read/);
});

test("a dashboard form sent with Origin: null passes the same-origin check only when the browser says same-origin", async () => {
  const post = (headers: Record<string, string>) =>
    fetch(`${base}/connect/record/renewals`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: "id=101&packageNumber=111&quantity=1&confirm=1" });
  // Not signed in, so a request that passes the check stops at 401, never 403.
  assert.equal((await post({ origin: "null", "sec-fetch-site": "same-origin" })).status, 401);
  assert.equal((await post({ origin: base })).status, 401);
  assert.equal((await post({ origin: "null", "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await post({ origin: "null" })).status, 403);
  assert.equal((await post({ origin: "https://evil.example.test", "sec-fetch-site": "same-origin" })).status, 403);
});

test("the dashboard form asks to confirm, and escapes what sundhed.dk wrote", async () => {
  const { renewalFormPage, renewalsPage } = await import("../src/dashboard.ts");
  const c = await renewalChoices("101", fakeClient().client);
  const form = renewalFormPage("da", { ...c, medicine: { ...c.medicine, drug: "<b>Testamol</b>" } });
  assert.match(form, /name="confirm" value="1" required/);
  assert.match(form, /value="222" required checked/);
  assert.ok(!form.includes("<b>Testamol</b>"));
  assert.ok(!/<script/i.test(form));
  const list = renewalsPage("en", { loggedIn: true, overview: await renewalOverview(fakeClient().client) });
  assert.match(list, /href="\/connect\/record\/renewals\/101"/);
  assert.ok(!list.includes("/connect/record/renewals/102\""));
  assert.match(renewalsPage("en", { loggedIn: false }), /href="\/connect"/);
});
