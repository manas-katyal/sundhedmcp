// A saved copy of the whole record, fetched right after each MitID login.
// MitID only lets the login happen on a computer, and sundhed.dk ends the
// session after a while; the copy lets the tools keep answering from a phone
// until the next login. Hosted, it is kept in encrypted storage (storage.ts)
// so it survives restarts; locally it lives in memory only.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { monthsAgo, sundhed } from "@sundhedmcp/client";
import type { ItemInput, ItemKind, OwnerStorage, StoredItem } from "./storage.ts";

/** How far back the copy's lab results go. */
export const LAB_YEARS = 10;

export interface Snapshot {
  savedAt: string;
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

let current: Snapshot | null = null;
let store: OwnerStorage | null = null;
let running: Promise<Snapshot> | null = null;

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
      const old: Snapshot = { medicationDetails: {}, prescriptionDetails: {}, vaccinationDetails: {}, errors: {}, ...JSON.parse(readFileSync(legacyFile, "utf8")) };
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
export const isRunning = () => running !== null;

const ids = (list: unknown, key: string): string[] =>
  Array.isArray(list) ? list.map((item) => (item as Record<string, unknown>)?.[key]).filter((v) => v !== undefined).map(String) : [];

/** Fetches everything, one call at a time. A failing part is noted and skipped. */
export function refresh(): Promise<Snapshot> {
  running ??= (async () => {
    const started = Date.now();
    const snap: Snapshot = { savedAt: new Date().toISOString(), medicationDetails: {}, prescriptionDetails: {}, vaccinationDetails: {}, errors: {} };
    const take = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (err) {
        snap.errors[name] = (err as Error).message;
        return undefined;
      }
    };

    snap.summary = await take("summary", sundhed.summary);
    snap.medicationCard = await take("medicationCard", sundhed.medicationCard);
    for (const id of ids(snap.medicationCard, "OrdinationId")) {
      snap.medicationDetails[id] = await take(`medicationDetails ${id}`, () => sundhed.medicationDetails(id));
    }
    snap.prescriptions = await take("prescriptions", sundhed.openPrescriptions);
    for (const id of ids(snap.prescriptions, "PrescriptionId")) {
      snap.prescriptionDetails[id] = await take(`prescription ${id}`, () => sundhed.prescription(id));
    }
    snap.vaccinations = await take("vaccinations", sundhed.vaccinations);
    for (const id of ids(snap.vaccinations, "VaccinationIdentifier")) {
      snap.vaccinationDetails[id] = await take(`vaccination ${id}`, () => sundhed.vaccination(id));
    }
    const to = new Date();
    const from = monthsAgo(LAB_YEARS * 12, to);
    const results = await take("labResults", () => sundhed.labResults(from, to));
    if (results !== undefined) snap.labResults = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), results };
    snap.referrals = await take("referrals", sundhed.referrals);

    keepFailedParts(snap, current);
    current = snap;
    if (store) await save(snap);
    const failed = Object.keys(snap.errors).length;
    log(`saved a copy in ${Math.round((Date.now() - started) / 1000)} s${failed ? `, ${failed} part(s) failed` : ""}`);
    return snap;
  })().finally(() => {
    running = null;
  });
  return running;
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
] as const satisfies ReadonlyArray<readonly [keyof Snapshot, ItemKind]>;
// The detail rows, and the part their ids come from.
const DETAILS = [
  ["medicationDetails", "medication_detail", "medicationCard"],
  ["prescriptionDetails", "prescription", "prescriptions"],
  ["vaccinationDetails", "vaccination", "vaccinations"],
] as const satisfies ReadonlyArray<readonly [keyof Snapshot, ItemKind, keyof Snapshot]>;

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
    if (snap.errors[key]) snap.errors[key] += ` (kept the copy from ${previous.savedAt})`;
  }
  for (const [key, , parent] of DETAILS) {
    for (const [id, data] of Object.entries(previous[key])) {
      if (snap[key][id] === undefined && (kept.has(parent) || id in snap[key])) snap[key][id] = data;
    }
  }
}

function toItems(snap: Snapshot): ItemInput[] {
  const items: ItemInput[] = [{ kind: "snapshot", id: "current", data: { savedAt: snap.savedAt, errors: snap.errors } }];
  for (const [key, kind] of PARTS) if (snap[key] !== undefined) items.push({ kind, id: "current", data: snap[key] });
  for (const [key, kind] of DETAILS) {
    for (const [id, data] of Object.entries(snap[key])) if (data !== undefined) items.push({ kind, id, data });
  }
  return items;
}

function fromItems(items: StoredItem[]): Snapshot | null {
  const meta = items.find((i) => i.kind === "snapshot")?.data as Pick<Snapshot, "savedAt" | "errors"> | undefined;
  if (!meta) return null;
  const snap: Snapshot = { savedAt: meta.savedAt, errors: meta.errors ?? {}, medicationDetails: {}, prescriptionDetails: {}, vaccinationDetails: {} };
  const record = snap as unknown as Record<string, unknown>;
  for (const [key, kind] of PARTS) {
    const item = items.find((i) => i.kind === kind);
    if (item) record[key] = item.data;
  }
  for (const [key, kind] of DETAILS) for (const item of items) if (item.kind === kind) snap[key][item.id] = item.data;
  return snap;
}

/** Writes the copy: changed rows, and drops details no longer in it. */
async function save(snap: Snapshot): Promise<void> {
  if (!store) return;
  await store.put(toItems(snap));
  for (const [key, kind] of PARTS) if (snap[key] === undefined) await store.delete(kind);
  for (const [key, kind] of DETAILS) await store.prune(kind, Object.keys(snap[key]).filter((id) => snap[key][id] !== undefined));
}
