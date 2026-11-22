// A saved copy of the whole record, fetched right after each MitID login and
// kept current part by part while the session lasts (sync.ts). MitID only
// lets the login happen on a computer, and sundhed.dk ends the session after
// a while; the copy lets the tools keep answering from a phone until the next
// login. Hosted, it is kept in encrypted storage (storage.ts) so it survives
// restarts; locally it lives in memory only.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { monthsAgo, sundhed } from "@sundhedmcp/client";
import { SessionGone } from "@sundhedmcp/session";
import type { ItemInput, ItemKind, OwnerStorage, StoredItem } from "./storage.ts";

/** How far back the copy's lab results go. */
export const LAB_YEARS = 10;

export interface Snapshot {
  /** When the copy last changed. */
  savedAt: string;
  /** When each part was last fetched. */
  fetchedAt: Partial<Record<PartName, string>>;
  summary?: unknown;
  medicationCard?: unknown;
  medicationDetails: Record<string, unknown>;
  prescriptions?: unknown;
  prescriptionDetails: Record<string, unknown>;
  vaccinations?: unknown;
  vaccinationDetails: Record<string, unknown>;
  labResults?: { from: string; to: string; results: unknown };
  referrals?: unknown;
  /** Parts that could not be fetched, with the reason. */
  errors: Record<string, string>;
}

/** The parts of the record, each fetched on its own (with its details). */
export const PART_NAMES = ["summary", "medicationCard", "prescriptions", "vaccinations", "labResults", "referrals"] as const;
export type PartName = (typeof PART_NAMES)[number];

export interface RefreshResult {
  snapshot: Snapshot;
  /** Parts that failed this time, and kept their previous copy. */
  failed: PartName[];
  /** sundhed.dk ended the session partway; the parts after it were not tried. */
  sessionEnded: boolean;
}

let current: Snapshot | null = null;
let store: OwnerStorage | null = null;

const log = (msg: string) => console.error(`[snapshot] ${msg}`);

/**
 * Keep the copy in this storage (hosted mode), and load the copy saved before
 * a restart. A plain-JSON `legacyFile` from an earlier version is moved into
 * the storage and then deleted, so the record is no longer on disk unencrypted.
 */
export async function useStorage(owner: OwnerStorage, legacyFile?: string): Promise<void> {
  store = owner;
  if (legacyFile && existsSync(legacyFile)) {
    try {
      const old = normalize(JSON.parse(readFileSync(legacyFile, "utf8")));
      if (!(await owner.get("snapshot", "current"))) await save(old);
      rmSync(legacyFile, { force: true });
      log(`moved the copy saved ${old.savedAt} into encrypted storage`);
    } catch (err) {
      log(`could not import ${legacyFile}: ${(err as Error).message}`);
    }
  }
  current = fromItems(await owner.list());
  if (current) log(`loaded the copy saved ${current.savedAt}`);
}

export const saved = () => current;

const ids = (list: unknown, key: string): string[] =>
  Array.isArray(list) ? list.map((item) => (item as Record<string, unknown>)?.[key]).filter((v) => v !== undefined).map(String) : [];

type Take = <T>(name: string, fn: () => Promise<T>) => Promise<T | undefined>;

// What each part fetches. Error names are the part, or `<details key> <id>`.
const FETCH: Record<PartName, (snap: Snapshot, take: Take) => Promise<void>> = {
  summary: async (snap, take) => {
    snap.summary = await take("summary", sundhed.summary);
  },
  medicationCard: async (snap, take) => {
    snap.medicationCard = await take("medicationCard", sundhed.medicationCard);
    for (const id of ids(snap.medicationCard, "OrdinationId")) {
      snap.medicationDetails[id] = await take(`medicationDetails ${id}`, () => sundhed.medicationDetails(id));
    }
  },
  prescriptions: async (snap, take) => {
    snap.prescriptions = await take("prescriptions", sundhed.openPrescriptions);
    for (const id of ids(snap.prescriptions, "PrescriptionId")) {
      snap.prescriptionDetails[id] = await take(`prescriptionDetails ${id}`, () => sundhed.prescription(id));
    }
  },
  vaccinations: async (snap, take) => {
    snap.vaccinations = await take("vaccinations", sundhed.vaccinations);
    for (const id of ids(snap.vaccinations, "VaccinationIdentifier")) {
      snap.vaccinationDetails[id] = await take(`vaccinationDetails ${id}`, () => sundhed.vaccination(id));
    }
  },
  labResults: async (snap, take) => {
    const to = new Date();
    const from = monthsAgo(LAB_YEARS * 12, to);
    const results = await take("labResults", () => sundhed.labResults(from, to));
    if (results !== undefined) snap.labResults = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), results };
  },
  referrals: async (snap, take) => {
    snap.referrals = await take("referrals", sundhed.referrals);
  },
};

// Fetches run one after another: a sync of one part waits for a full refresh.
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
let fullRun: Promise<RefreshResult> | null = null;

export const isRunning = () => pending > 0;

/**
 * Fetches the given parts (default: all), one call at a time, into the copy.
 * A part that fails keeps its previous copy; the others are replaced.
 */
export function refresh(parts: readonly PartName[] = PART_NAMES): Promise<RefreshResult> {
  const full = PART_NAMES.every((p) => parts.includes(p));
  if (full && fullRun) return fullRun;
  pending++;
  const run = queue
    .then(() => fetchParts(parts))
    .finally(() => {
      pending--;
      if (full) fullRun = null;
    });
  queue = run.catch(() => {});
  if (full) fullRun = run;
  return run;
}

async function fetchParts(parts: readonly PartName[]): Promise<RefreshResult> {
  const started = Date.now();
  const previous = current;
  const snap = startFrom(previous, parts);
  const take: Take = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SessionGone) throw err;
      snap.errors[name] = (err as Error).message;
      return undefined;
    }
  };

  const failed: PartName[] = [];
  let sessionEnded = false;
  for (const part of parts) {
    if (!sessionEnded) {
      try {
        await FETCH[part](snap, take);
      } catch (err) {
        if (!(err instanceof SessionGone)) throw err;
        sessionEnded = true;
        // Half a part is worse than the previous copy of all of it.
        clearPart(snap, part);
      }
    }
    if (sessionEnded) snap.errors[part] = "The sundhed.dk session ended before this part was fetched.";
    if (snap[part] === undefined) failed.push(part);
    else snap.fetchedAt[part] = snap.savedAt;
  }

  keepFailedParts(snap, previous);
  current = snap;
  if (store) await save(snap);
  const what = parts.length === PART_NAMES.length ? "a copy" : parts.join(", ");
  log(`saved ${what} in ${Math.round((Date.now() - started) / 1000)} s${failed.length ? `, ${failed.length} part(s) failed` : ""}`);
  return { snapshot: snap, failed, sessionEnded };
}

/** Deletes the copy, in memory and in storage. */
export async function forget(): Promise<void> {
  current = null;
  await store?.delete();
}

// A whole part when one fetch returns it; one row per detail otherwise.
const PARTS = [
  ["summary", "summary"],
  ["medicationCard", "medication_card"],
  ["prescriptions", "prescriptions"],
  ["vaccinations", "vaccinations"],
  ["labResults", "lab_results"],
  ["referrals", "referrals"],
] as const satisfies ReadonlyArray<readonly [PartName, ItemKind]>;
// The detail rows, and the part their ids come from.
const DETAILS = [
  ["medicationDetails", "medication_detail", "medicationCard"],
  ["prescriptionDetails", "prescription", "prescriptions"],
  ["vaccinationDetails", "vaccination", "vaccinations"],
] as const satisfies ReadonlyArray<readonly [keyof Snapshot, ItemKind, PartName]>;

/** The previous copy, with the parts about to be fetched taken out. */
function startFrom(previous: Snapshot | null, parts: readonly PartName[]): Snapshot {
  const savedAt = new Date().toISOString();
  const snap: Snapshot = previous
    ? { ...structuredClone(previous), savedAt }
    : { savedAt, fetchedAt: {}, medicationDetails: {}, prescriptionDetails: {}, vaccinationDetails: {}, errors: {} };
  for (const part of parts) clearPart(snap, part);
  return snap;
}

function clearPart(snap: Snapshot, part: PartName): void {
  delete snap[part];
  for (const [key, , parent] of DETAILS) {
    if (parent !== part) continue;
    snap[key] = {};
    for (const name of Object.keys(snap.errors)) if (name.startsWith(`${key} `)) delete snap.errors[name];
  }
  delete snap.errors[part];
}

/**
 * A part that failed this time keeps what the previous copy had, so one
 * failing endpoint does not erase it; its error says how old that is. So do
 * the details of a kept part, and single details that failed.
 */
export function keepFailedParts(snap: Snapshot, previous: Snapshot | null): void {
  if (!previous) return;
  const record = snap as unknown as Record<string, unknown>;
  const kept = new Set<string>();
  for (const [key] of PARTS) {
    if (snap[key] !== undefined || previous[key] === undefined) continue;
    record[key] = previous[key];
    kept.add(key);
    const from = previous.fetchedAt[key] ?? previous.savedAt;
    if (snap.errors[key]) snap.errors[key] += ` (kept the copy from ${from})`;
  }
  for (const [key, , parent] of DETAILS) {
    for (const [id, data] of Object.entries(previous[key])) {
      if (snap[key][id] === undefined && (kept.has(parent) || id in snap[key])) snap[key][id] = data;
    }
  }
}

/** Fills in what a copy from an earlier version lacks. */
function normalize(snap: Partial<Snapshot> & { savedAt: string }): Snapshot {
  const out: Snapshot = { medicationDetails: {}, prescriptionDetails: {}, vaccinationDetails: {}, errors: {}, ...snap, fetchedAt: { ...snap.fetchedAt } };
  // Before sync, every part was fetched together.
  for (const part of PART_NAMES) if (out[part] !== undefined) out.fetchedAt[part] ??= out.savedAt;
  return out;
}

function toItems(snap: Snapshot): ItemInput[] {
  const items: ItemInput[] = [{ kind: "snapshot", id: "current", data: { savedAt: snap.savedAt, fetchedAt: snap.fetchedAt, errors: snap.errors } }];
  for (const [key, kind] of PARTS) if (snap[key] !== undefined) items.push({ kind, id: "current", data: snap[key] });
  for (const [key, kind] of DETAILS) {
    for (const [id, data] of Object.entries(snap[key])) if (data !== undefined) items.push({ kind, id, data });
  }
  return items;
}

function fromItems(items: StoredItem[]): Snapshot | null {
  const meta = items.find((i) => i.kind === "snapshot")?.data as Pick<Snapshot, "savedAt" | "fetchedAt" | "errors"> | undefined;
  if (!meta) return null;
  const snap: Snapshot = { savedAt: meta.savedAt, fetchedAt: meta.fetchedAt ?? {}, errors: meta.errors ?? {}, medicationDetails: {}, prescriptionDetails: {}, vaccinationDetails: {} };
  const record = snap as unknown as Record<string, unknown>;
  for (const [key, kind] of PARTS) {
    const item = items.find((i) => i.kind === kind);
    if (item) record[key] = item.data;
  }
  for (const [key, kind] of DETAILS) for (const item of items) if (item.kind === kind) snap[key][item.id] = item.data;
  return normalize(snap);
}

/** Writes the copy: changed rows, and drops details no longer in it. */
async function save(snap: Snapshot): Promise<void> {
  if (!store) return;
  await store.put(toItems(snap));
  for (const [key, kind] of PARTS) if (snap[key] === undefined) await store.delete(kind);
  for (const [key, kind] of DETAILS) await store.prune(kind, Object.keys(snap[key]).filter((id) => snap[key][id] !== undefined));
}
