import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

// config.ts reads the environment when it is first imported.
const dataDir = mkdtempSync(join(tmpdir(), "sundhedmcp-test-"));
process.env.DATA_DIR = dataDir;
delete process.env.ADMIN_PASSWORD;

let server: Server;
let port = 0;

before(async () => {
  const { createApp } = await import("../src/app.ts");
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
  const app = createApp({ port, onPublicUrl: () => {}, env: {} });
  server.on("request", app);
});

after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const setup = (headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}/setup`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: "password=correct-horse-battery&confirm=correct-horse-battery",
  });

const settings = () => existsSync(join(dataDir, "settings.json"));

test("/setup refuses requests that came in through Funnel", async () => {
  const res = await setup({ "x-forwarded-for": "203.0.113.7" });
  assert.equal(res.status, 403);
  assert.equal(settings(), false);
});

test("/setup refuses a form posted from another site", async () => {
  const res = await setup({ origin: "https://evil.example" });
  assert.equal(res.status, 403);
  assert.equal(settings(), false);
});

test("/setup accepts the guide's own form on this computer", async () => {
  const res = await setup({ origin: `http://127.0.0.1:${port}` });
  assert.equal(res.status, 303);
  assert.equal(settings(), true);
});
