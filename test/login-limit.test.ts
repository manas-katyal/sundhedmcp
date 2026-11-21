import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

// config.ts reads the environment when it is first imported.
const dataDir = mkdtempSync(join(tmpdir(), "sundhedmcp-test-"));
const PASSWORD = "correct-horse-battery";
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = PASSWORD;

let server: Server;
let port = 0;

before(async () => {
  const { createApp } = await import("../src/app.ts");
  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// Behind Funnel or a platform proxy, req.ip comes from X-Forwarded-For.
const signIn = (password: string, ip: string) =>
  fetch(`http://127.0.0.1:${port}/connect/signin`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
    body: new URLSearchParams({ password }),
  });

test("wrong passwords from many addresses lock every address out", async () => {
  // Four tries per address stays under the per-address lockout of five.
  for (let i = 0; i < 20; i++) assert.equal((await signIn("wrong-password-123", `203.0.113.${Math.floor(i / 4)}`)).status, 401);
  assert.equal((await signIn(PASSWORD, "198.51.100.1")).status, 429);
});
