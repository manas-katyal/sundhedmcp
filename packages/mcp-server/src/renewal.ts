// Prescription renewal: asks the person's GP, through sundhed.dk, to renew a
// prescription, as the medicine card's own "Forny recept" button does. It is
// the only thing SundhedMCP writes to sundhed.dk, and it is off unless
// SUNDHEDMCP_ALLOW_RENEWAL=1. Every way in (the MCP tool, the API, the
// dashboard) shows the choice first and sends only when told to.
//
// Calls run live against the caller's sundhed.dk session (asOwner), not the
// saved copy: a renewal must be checked against the medicine card as it is now.
import { clean, sundhed } from "@sundhedmcp/client";

/** The sundhed.dk calls renewal needs; tests pass made-up ones. */
export interface RenewalClient {
  renewable(): Promise<unknown>;
  renewalPackages(drugMedicationId: string): Promise<unknown>;
  renewalRequests(): Promise<unknown>;
  requestRenewal(r: { drugMedicationId: string | number; medicineCardVersion: unknown; packageNumber: string | number; quantity: number }): Promise<unknown>;
}

export interface RenewableMedicine {
  id: string;
  drug: string;
  form?: string;
  strength?: string;
  /** sundhed.dk's status code for the row. */
  status: number;
  renewable: boolean;
  /** Why it cannot be renewed, when it cannot. */
  reason?: string;
}

export interface RenewalPackage {
  number: string;
  text: string;
}

export interface RenewalOverview {
  /** The person has a GP to send requests to. */
  hasDoctor: boolean;
  medicines: RenewableMedicine[];
  /** Requests sent earlier, as sundhed.dk lists them. */
  requests: unknown;
}

export const MAX_QUANTITY = 10;

type ErrorCode = "not_found" | "not_renewable" | "invalid_package" | "invalid_quantity";

/** A renewal that cannot be asked for as given. The message says why, for the person. */
export class RenewalError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface Row {
  Id?: string | number;
  Status?: number;
  Drug?: string;
  Form?: string;
  Strength?: string;
  HasWriteAccess?: boolean;
}
interface Ordinations {
  List?: Row[];
  HasDoctor?: boolean;
  MedicineCardVersion?: unknown;
}
interface Packages {
  Packages?: { Varenummer?: string | number; Tekst?: string }[];
  DefaultPackageNumber?: string | number;
}

// What the medicine card says next to a row it does not offer to renew.
const REASONS: Record<number, string> = {
  1: "It is private-marked (negative consent); remove the marking on sundhed.dk first.",
  2: "sundhed.dk says this prescription cannot be renewed.",
  3: "sundhed.dk says this prescription cannot be renewed.",
  4: "A renewal of it is already being handled.",
  5: "sundhed.dk does not offer to renew it.",
  6: "It is dose-dispensed; ask the GP or pharmacy instead.",
};

const text = (v: unknown) => (typeof v === "string" ? (clean(v) as string | undefined) : undefined);

function medicine(row: Row, hasDoctor: boolean): RenewableMedicine {
  const status = typeof row.Status === "number" ? row.Status : -1;
  let reason: string | undefined;
  if (!hasDoctor) reason = "No GP is registered to send it to.";
  else if (status !== 0) reason = REASONS[status] ?? "sundhed.dk does not offer to renew it.";
  else if (row.HasWriteAccess === false) reason = "You can see this medicine card but not ask for renewals on it.";
  return { id: String(row.Id), drug: text(row.Drug) ?? "?", form: text(row.Form), strength: text(row.Strength), status, renewable: !reason, ...(reason ? { reason } : {}) };
}

async function ordinations(client: RenewalClient) {
  const raw = ((await client.renewable()) ?? {}) as Ordinations;
  const hasDoctor = raw.HasDoctor === true;
  // Rows being handled are left out, as on sundhed.dk.
  const rows = (raw.List ?? []).filter((r) => r.Id !== undefined && r.Status !== 4);
  return { raw, rows, hasDoctor };
}

/** Every medicine the renewal page lists, whether each can be renewed, and earlier requests. */
export async function renewalOverview(client: RenewalClient = sundhed): Promise<RenewalOverview> {
  const [{ rows, hasDoctor }, requests] = await Promise.all([ordinations(client), client.renewalRequests()]);
  return { hasDoctor, medicines: rows.map((r) => medicine(r, hasDoctor)), requests: requests ?? [] };
}

async function find(client: RenewalClient, id: string) {
  const o = await ordinations(client);
  const row = o.rows.find((r) => String(r.Id) === id);
  if (!row) throw new RenewalError("not_found", "No medicine with that id can be renewed. List them again; the id comes from that list.");
  const m = medicine(row, o.hasDoctor);
  if (!m.renewable) throw new RenewalError("not_renewable", `${m.drug} cannot be renewed here: ${m.reason}`);
  return { ...o, row, medicine: m };
}

async function packagesOf(client: RenewalClient, row: Row) {
  const raw = ((await client.renewalPackages(String(row.Id))) ?? {}) as Packages;
  const list = (raw.Packages ?? []).filter((p) => p.Varenummer !== undefined);
  return { raw, list };
}

/** What a renewal of one medicine can ask for: the package sizes, and the one sundhed.dk picks by default. */
export async function renewalChoices(id: string, client: RenewalClient = sundhed) {
  const { row, medicine: m } = await find(client, id);
  const { raw, list } = await packagesOf(client, row);
  const packages: RenewalPackage[] = list.map((p) => ({ number: String(p.Varenummer), text: text(p.Tekst) ?? String(p.Varenummer) }));
  const preferred = raw.DefaultPackageNumber === undefined ? undefined : String(raw.DefaultPackageNumber);
  return { medicine: m, packages, defaultPackage: packages.some((p) => p.number === preferred) ? preferred : undefined, maxQuantity: MAX_QUANTITY };
}

/**
 * Sends the renewal request to the person's GP. Checks it against the medicine
 * card as it is now, so a stale id or package cannot be sent.
 */
export async function sendRenewal(request: { id: string; packageNumber: string; quantity: number }, client: RenewalClient = sundhed) {
  const { quantity } = request;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new RenewalError("invalid_quantity", `The number of packages must be a whole number from 1 to ${MAX_QUANTITY}.`);
  }
  const { raw, row, medicine: m } = await find(client, request.id);
  const { list } = await packagesOf(client, row);
  const pkg = list.find((p) => String(p.Varenummer) === request.packageNumber);
  if (!pkg) throw new RenewalError("invalid_package", `That package is not one ${m.drug} can be renewed with. Pick one of the package numbers offered.`);
  // The ids go back exactly as sundhed.dk gave them, number or string.
  await client.requestRenewal({ drugMedicationId: row.Id as string | number, medicineCardVersion: raw.MedicineCardVersion, packageNumber: pkg.Varenummer as string | number, quantity });
  return { sent: true as const, medicine: m, package: { number: String(pkg.Varenummer), text: text(pkg.Tekst) ?? String(pkg.Varenummer) }, quantity };
}
