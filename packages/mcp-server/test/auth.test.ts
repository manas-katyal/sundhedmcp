import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
