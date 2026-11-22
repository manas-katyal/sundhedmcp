import { test } from "node:test";
import assert from "node:assert/strict";
import { PART_NAMES, type PartName, type RefreshResult, type Snapshot } from "../src/snapshot.ts";
import { createSync, SYNC_INTERVALS_MS } from "../src/sync.ts";

const MINUTE = 60_000;
const snapshot: Snapshot = { savedAt: "", fetchedAt: {}, medicationDetails: {}, prescriptionDetails: {}, vaccinationDetails: {}, errors: {} };

function harness(answer: (parts: readonly PartName[]) => Partial<RefreshResult> = () => ({})) {
  let clock = 0;
  const calls: (readonly PartName[])[] = [];
  const sync = createSync({
    now: () => clock,
    random: () => 0.5, // no jitter
    refresh: async (parts = PART_NAMES) => {
      calls.push(parts);
      return { snapshot, failed: [], sessionEnded: false, ...answer(parts) };
    },
  });
  return { sync, calls, advance: (ms: number) => (clock += ms) };
}

test("after a login, each part is fetched again on its own interval", async () => {
  const { sync, calls, advance } = harness();
  await sync.tick();
  assert.equal(calls.length, 0, "nothing runs before a login");

  await sync.loggedIn();
  assert.deepEqual(calls, [PART_NAMES]);
  assert.equal(sync.status().active, true);

  advance(SYNC_INTERVALS_MS.summary - 1);
  await sync.tick();
  assert.equal(calls.length, 1);

  advance(1);
  // The hourly parts are due together; one runs per tick.
  for (let i = 0; i < 5; i++) await sync.tick();
  assert.deepEqual(calls.slice(1), [["summary"], ["medicationCard"], ["prescriptions"]]);
});

test("a failing part is retried sooner, then less often", async () => {
  const { sync, calls, advance } = harness((parts) => ({ failed: parts.filter((p) => p === "referrals") }));
  await sync.loggedIn();
  assert.equal(sync.status().parts.referrals.failures, 1);

  advance(10 * MINUTE);
  await sync.tick();
  assert.deepEqual(calls.at(-1), ["referrals"]);
  assert.equal(sync.status().parts.referrals.failures, 2);
  assert.equal(sync.status().parts.referrals.nextRun, new Date(10 * MINUTE + 20 * MINUTE).toISOString());
});

test("sync stops when sundhed.dk ends the session, until the next login", async () => {
  let ended = false;
  const { sync, calls, advance } = harness(() => ({ sessionEnded: ended }));
  await sync.loggedIn();
  ended = true;
  advance(SYNC_INTERVALS_MS.summary);
  await sync.tick();
  assert.equal(sync.status().active, false);
  assert.equal(sync.status().parts.summary.nextRun, null);

  advance(SYNC_INTERVALS_MS.summary);
  await sync.tick();
  assert.equal(calls.length, 2);

  ended = false;
  await sync.loggedIn();
  assert.equal(sync.status().active, true);
});

test("with sync off, a login still fetches the record, and nothing more", async () => {
  const calls: (readonly PartName[])[] = [];
  const refresh = async (parts: readonly PartName[] = PART_NAMES) => {
    calls.push(parts);
    return { snapshot, failed: [], sessionEnded: false };
  };
  const sync = createSync({ refresh }, false);
  await sync.loggedIn();
  assert.equal(sync.status().active, false);
  await sync.tick();
  assert.equal(calls.length, 1);
});
