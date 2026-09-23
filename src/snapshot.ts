// A saved copy of the whole record, fetched right after each MitID login.
// MitID only lets the login happen on a computer, and sundhed.dk ends the
// session after a while; the copy lets the tools keep answering from a phone
// until the next login. Hosted, it is kept on the server's volume (owner-only
// file) so it survives restarts; locally it lives in memory only.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as sundhed from "./sundhed.ts";
import { monthsAgo } from "./data.ts";

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
let file: string | null = null;
let running: Promise<Snapshot> | null = null;

const log = (msg: string) => console.error(`[snapshot] ${msg}`);

/** Keep the copy in this file (hosted mode). Loads a copy saved before a restart. */
export function persistTo(path: string): void {
  file = path;
  if (!existsSync(path)) return;
  try {
    current = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
    log(`loaded the copy saved ${current.savedAt}`);
  } catch (err) {
    log(`could not read ${path}: ${(err as Error).message}`);
  }
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

    current = snap;
    if (file) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(snap), { mode: 0o600 });
      chmodSync(file, 0o600);
    }
    const failed = Object.keys(snap.errors).length;
    log(`saved a copy in ${Math.round((Date.now() - started) / 1000)} s${failed ? `, ${failed} part(s) failed` : ""}`);
    return snap;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Deletes the copy, in memory and on disk. */
export function forget(): void {
  current = null;
  if (file) rmSync(file, { force: true });
}
