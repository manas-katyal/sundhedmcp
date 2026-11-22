import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SingleUserProvider } from "../src/auth.ts";
import { Store } from "../src/store.ts";

test("an API token is accepted on /mcp, and nothing else is", async () => {
  const store = new Store(join(mkdtempSync(join(tmpdir(), "sundhedmcp-test-")), "oauth.json"));
  const token = "k".repeat(40);
  const provider = new SingleUserProvider(store, { apiTokens: [token] });
  const info = await provider.verifyAccessToken(token);
  assert.equal(info.clientId, "api-token");
  assert.ok((info.expiresAt ?? 0) > Date.now() / 1000, "the SDK refuses a token without a future expiry");
  await assert.rejects(provider.verifyAccessToken("k".repeat(39)), /Invalid access token/);
  await assert.rejects(new SingleUserProvider(store).verifyAccessToken(token), /Invalid access token/);
});

test("the OAuth state moves from oauth.json into storage and stays there", async () => {
  const { openStorage, SERVER_OWNER_ID } = await import("../src/storage.ts");
  const dir = mkdtempSync(join(tmpdir(), "sundhedmcp-test-"));
  const file = join(dir, "oauth.json");
  const before = new Store(file);
  before.update((d) => void (d.password_fingerprint = "fp-1"));
  assert.ok(existsSync(file));
  const storage = await openStorage(dir, "sqlite", {});
  assert.ok(storage);
  const store = new Store(file);
  await store.useStorage(storage.forOwner(SERVER_OWNER_ID));
  assert.equal(existsSync(file), false, "the file is deleted once it is in storage");
  assert.equal(store.data.password_fingerprint, "fp-1");
  store.update((d) => void (d.password_fingerprint = "fp-2"));
  await store.flush();
  assert.equal(existsSync(file), false, "changes go to storage, not the file");
  const again = new Store(file);
  await again.useStorage(storage.forOwner(SERVER_OWNER_ID));
  assert.equal(again.data.password_fingerprint, "fp-2");
  await storage.close();
});
