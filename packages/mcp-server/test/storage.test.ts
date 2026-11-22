import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStorageKeys, ownerCipher, StorageKeyError } from "../src/storage-crypto.ts";
import { postgresDriver, type SqlDriver, sqliteDriver } from "../src/storage-sql.ts";
import { createStorage, openStorage, SINGLE_OWNER_ID } from "../src/storage.ts";
import { keepFailedParts, saved, useStorage, type Snapshot } from "../src/snapshot.ts";

// Made-up data only. Never put a real record or CPR number here.
const tempDir = () => mkdtempSync(join(tmpdir(), "sundhedmcp-test-"));

test("a sealed row opens only with its owner, kind and id", () => {
  const key = randomBytes(32);
  const alice = ownerCipher(key, "alice");
  const sealed = alice.seal("alice\nsummary\ncurrent", '{"name":"Test Person"}');
  assert.ok(!sealed.includes("Test Person"));
  assert.equal(alice.open("alice\nsummary\ncurrent", sealed), '{"name":"Test Person"}');
  assert.throws(() => alice.open("alice\nsummary\nother", sealed), StorageKeyError);
  assert.throws(() => ownerCipher(key, "bob").open("alice\nsummary\ncurrent", sealed), StorageKeyError);
});

test("an earlier key still opens what it sealed", () => {
  const old = randomBytes(32);
  const sealed = ownerCipher(old, "default").seal("aad", "data");
  const rotated = ownerCipher({ current: randomBytes(32), previous: [old] }, "default");
  assert.equal(rotated.open("aad", sealed), "data");
  assert.ok(!sealed.startsWith(rotated.currentPrefix));
  assert.throws(() => ownerCipher(randomBytes(32), "default").open("aad", sealed), StorageKeyError);
});

test("the key file is created once, owner-only, and becomes a previous key when a key is given", () => {
  const dir = tempDir();
  const file = join(dir, "storage.key");
  const first = loadStorageKeys({}, file);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(loadStorageKeys({}, file).current, first.current);
  const given = randomBytes(32).toString("base64");
  const keys = loadStorageKeys({ SUNDHEDMCP_STORAGE_KEY: given }, file);
  assert.equal(keys.current.toString("base64"), given);
  assert.deepEqual(keys.previous, [first.current]);
  assert.throws(() => loadStorageKeys({ SUNDHEDMCP_STORAGE_KEY: "c2hvcnQ=" }, file), StorageKeyError);
});

test("openStorage turns storage off, and rejects unknown types", async () => {
  assert.equal(await openStorage(tempDir(), "none"), null);
  assert.equal(await openStorage(tempDir(), "sqlite", { SUNDHEDMCP_STORAGE: "none" }), null);
  await assert.rejects(openStorage(tempDir(), "sqlite", { SUNDHEDMCP_STORAGE: "mysql" }), /sqlite, postgres or none/);
  await assert.rejects(openStorage(tempDir(), "sqlite", { SUNDHEDMCP_STORAGE: "postgres" }), /SUNDHEDMCP_DATABASE_URL/);
});

async function exercise(driver: SqlDriver) {
  const key = randomBytes(32);
  const storage = await createStorage(driver, key, { type: driver.dialect, location: "test" });
  const owner = storage.forOwner(`test-${randomBytes(4).toString("hex")}`);
  try {
    assert.deepEqual(await owner.put([{ kind: "summary", id: "current", data: { a: 1 } }, { kind: "vaccination", id: "v1", data: { b: 2 } }]), { changed: 2, unchanged: 0 });
    assert.deepEqual(await owner.put([{ kind: "summary", id: "current", data: { a: 1 } }]), { changed: 0, unchanged: 1 });
    assert.deepEqual(await owner.put([{ kind: "summary", id: "current", data: { a: 3 } }]), { changed: 1, unchanged: 0 });
    assert.deepEqual((await owner.get("summary", "current"))?.data, { a: 3 });
    assert.equal(await owner.get("summary", "missing"), null);

    await owner.put([{ kind: "vaccination", id: "v2", data: {} }, { kind: "vaccination", id: "v3", data: {} }]);
    assert.equal(await owner.prune("vaccination", ["v2"]), 2);
    assert.deepEqual((await owner.list("vaccination")).map((i) => i.id), ["v2"]);

    // The database holds only ciphertext.
    const rows = await driver.all<{ payload: string }>("SELECT payload FROM items WHERE owner_id = $1", [owner.ownerId]);
    assert.ok(rows.every((r) => r.payload.startsWith("v1.")));

    // Rotate: the old key becomes a previous key, and reencrypt seals again.
    const rotated = await createStorage(driver, { current: randomBytes(32), previous: [key] }, { type: driver.dialect, location: "test" });
    const again = rotated.forOwner(owner.ownerId);
    assert.equal((await again.keyStatus()).stale, 2);
    assert.deepEqual(await again.reencrypt(), { reencrypted: 2, unreadable: 0 });
    assert.equal((await again.keyStatus()).stale, 0);
    assert.deepEqual((await again.get("summary", "current"))?.data, { a: 3 });

    assert.equal(await again.delete(), 2);
    assert.deepEqual(await again.list(), []);
  } finally {
    await owner.delete();
    await storage.close();
  }
}

test("sqlite storage: put, get, prune, rotate, delete", async () => {
  const path = join(tempDir(), "sundhed.db");
  await exercise(await sqliteDriver(path));
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

const pgUrl = process.env.SUNDHEDMCP_TEST_DATABASE_URL;
test("postgres storage: put, get, prune, rotate, delete", { skip: pgUrl ? false : "set SUNDHEDMCP_TEST_DATABASE_URL" }, async () => {
  await exercise(await postgresDriver(pgUrl as string));
});

test("a plain snapshot.json is moved into storage, and the copy survives a restart", async () => {
  const dir = tempDir();
  const legacy = join(dir, "snapshot.json");
  const snap: Snapshot = {
    savedAt: "2026-01-02T03:04:05.000Z",
    fetchedAt: {},
    summary: { name: "Test Person" },
    medicationCard: [{ OrdinationId: "m1" }],
    medicationDetails: { m1: { drug: "Testamol" } },
    prescriptionDetails: {},
    vaccinations: [],
    vaccinationDetails: {},
    labResults: { from: "2016-01-02", to: "2026-01-02", results: [] },
    errors: { referrals: "HTTP 500" },
  };
  // A copy from before sync has no fetchedAt; every part it has was fetched at savedAt.
  const { fetchedAt: _, ...old } = snap;
  writeFileSync(legacy, JSON.stringify(old));
  const at = snap.savedAt;
  snap.fetchedAt = { summary: at, medicationCard: at, vaccinations: at, labResults: at };

  const env = { SUNDHEDMCP_STORAGE_KEY: randomBytes(32).toString("base64") };
  const storage = await openStorage(dir, "sqlite", env);
  assert.ok(storage);
  await useStorage(storage.forOwner(SINGLE_OWNER_ID), legacy);
  assert.equal(existsSync(legacy), false);
  assert.deepEqual(saved(), snap);
  await storage.close();
  assert.ok(!readFileSync(join(dir, "sundhed.db")).includes("Testamol"));

  const reopened = await openStorage(dir, "sqlite", env);
  assert.ok(reopened);
  await useStorage(reopened.forOwner(SINGLE_OWNER_ID));
  assert.deepEqual(saved(), snap);
  await reopened.close();
});

test("a part that failed keeps the previous copy, with its details", () => {
  const empty = { medicationDetails: {}, prescriptionDetails: {}, vaccinationDetails: {} };
  const previous: Snapshot = {
    ...empty,
    savedAt: "2026-01-01T00:00:00.000Z",
    fetchedAt: { medicationCard: "2025-12-31T00:00:00.000Z" },
    medicationCard: [{ OrdinationId: "m1" }],
    medicationDetails: { m1: { drug: "Testamol" } },
    vaccinations: [{ VaccinationIdentifier: "v1" }],
    vaccinationDetails: { v1: { name: "Test vaccine" } },
    errors: {},
  };
  const now: Snapshot = {
    ...empty,
    savedAt: "2026-02-01T00:00:00.000Z",
    fetchedAt: {},
    vaccinations: [{ VaccinationIdentifier: "v1" }],
    vaccinationDetails: { v1: undefined },
    errors: { medicationCard: "HTTP 500", "vaccinationDetails v1": "HTTP 502" },
  };
  keepFailedParts(now, previous);
  assert.deepEqual(now.medicationCard, previous.medicationCard);
  assert.deepEqual(now.medicationDetails, previous.medicationDetails);
  assert.deepEqual(now.vaccinationDetails, previous.vaccinationDetails);
  assert.equal(now.errors.medicationCard, "HTTP 500 (kept the copy from 2025-12-31T00:00:00.000Z)");
  assert.equal(now.prescriptions, undefined);
});

test("a kept login is stored encrypted with its owner's copy, found after a restart, and dropped when it ends", async () => {
  const { SundhedSession } = await import("@sundhedmcp/session");
  const { LOGIN_SETTING, SavedCopy } = await import("../src/snapshot.ts");
  const dir = tempDir();
  const env = { SUNDHEDMCP_STORAGE_KEY: randomBytes(32).toString("base64") };
  const storage = await openStorage(dir, "sqlite", env);
  assert.ok(storage);
  const session = new SundhedSession("test");
  // The session hands its login to whatever persistLogin was given; catch it.
  let keep: ((login: unknown) => Promise<void>) | undefined;
  session.persistLogin = (fn) => void (keep = fn as typeof keep);
  const copy = new SavedCopy(session);
  await copy.useStorage(storage.forOwner("abc123"));
  assert.equal(keep as unknown, undefined, "only hosted mode keeps the login");
  copy.keepLogin();
  assert.ok(keep);
  const login = { cookies: [{ name: "made-up", value: "not-a-real-cookie", domain: ".sundhed.example.test", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] };
  await keep(login);
  assert.deepEqual(await storage.ownersWith("setting", LOGIN_SETTING), ["abc123"]);
  assert.deepEqual(await copy.setting(LOGIN_SETTING), login);
  await storage.close();
  assert.ok(!readFileSync(join(dir, "sundhed.db")).includes("not-a-real-cookie"));

  const reopened = await openStorage(dir, "sqlite", env);
  assert.ok(reopened);
  const restarted = new SundhedSession("test");
  restarted.persistLogin = (fn) => void (keep = fn as typeof keep);
  const again = new SavedCopy(restarted);
  await again.useStorage(reopened.forOwner("abc123"));
  again.keepLogin();
  assert.deepEqual(await again.setting(LOGIN_SETTING), login);
  // Another owner has none.
  assert.equal(await reopened.forOwner("other").get("setting", LOGIN_SETTING), null);
  // The login ended: it is dropped.
  await keep(null);
  assert.deepEqual(await reopened.ownersWith("setting", LOGIN_SETTING), []);
  await reopened.close();
});
