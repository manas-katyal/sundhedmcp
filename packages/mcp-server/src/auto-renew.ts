// Auto-renew: a person picks a medicine, a package and a number of packages
// once, and the server asks their GP to renew it again whenever it is due, as
// the renewal form would. It needs SUNDHEDMCP_ALLOW_RENEWAL=1 like every
// renewal, and a rule is only made from a renewal the person sent themselves.
//
// - Due: never sent, or sent at least the cooldown ago (default 14 days,
//   SUNDHEDMCP_AUTO_RENEW_COOLDOWN_DAYS). Asking once too often is better than
//   running out; the GP and sundhed.dk turn away a request already handled.
// - Checked once a day, and a minute after each MitID login. Every check goes
//   through sendRenewal, so it is checked against the medicine card as it is
//   then: a medicine no longer offered for renewal is skipped, not sent.
// - Logged out, nothing is sent: the check is recorded as missed, shown on the
//   renewals page, and tried again after the next login.
//
// Rules and the log of what was done live with the person's copy, encrypted
// (setting "auto_renew"); "Forget" deletes them.
import { onLogin, type SundhedSession } from "@sundhedmcp/session";
import { RenewalError, type RenewalClient, renewalOverview, sendRenewal } from "./renewal.ts";
import { asOwner, type SavedCopy } from "./snapshot.ts";

export const AUTO_RENEW_SETTING = "auto_renew";

const DAY = 24 * 60 * 60_000;
const MAX_EVENTS = 50;

export interface AutoRenewRule {
  /** sundhed.dk's id of the medicine on the renewal list. */
  id: string;
  drug: string;
  strength?: string;
  packageNumber: string;
  packageText: string;
  quantity: number;
  /** ISO times. */
  addedAt: string;
  lastSentAt?: string;
}

export interface AutoRenewEvent {
  at: string;
  id: string;
  drug: string;
  outcome: "sent" | "skipped" | "failed" | "missed";
  detail: string;
}

export interface AutoRenewState {
  rules: AutoRenewRule[];
  lastCheckAt?: string;
  /** Newest first. */
  events: AutoRenewEvent[];
}

/** Where the state is kept: a SavedCopy, or a stand-in in tests. */
export interface SettingStore {
  setting(id: string): Promise<unknown>;
  setSetting(id: string, data: unknown): Promise<void>;
}

export function cooldownMs(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number(env.SUNDHEDMCP_AUTO_RENEW_COOLDOWN_DAYS?.trim() || 14);
  return (Number.isFinite(days) && days >= 1 ? days : 14) * DAY;
}

export async function loadAutoRenew(store: SettingStore): Promise<AutoRenewState> {
  const raw = (await store.setting(AUTO_RENEW_SETTING)) as Partial<AutoRenewState> | undefined;
  return { rules: Array.isArray(raw?.rules) ? raw.rules : [], events: Array.isArray(raw?.events) ? raw.events : [], ...(raw?.lastCheckAt ? { lastCheckAt: raw.lastCheckAt } : {}) };
}

const save = (store: SettingStore, state: AutoRenewState) => store.setSetting(AUTO_RENEW_SETTING, { ...state, events: state.events.slice(0, MAX_EVENTS) });

/** When a rule is next due. */
export const nextDue = (rule: AutoRenewRule, cooldown: number): Date => new Date(rule.lastSentAt ? Date.parse(rule.lastSentAt) + cooldown : Date.parse(rule.addedAt));

/** Adds a rule for a medicine, or replaces the one it had, after a renewal of it was sent now. */
export async function addRule(store: SettingStore, rule: Omit<AutoRenewRule, "addedAt" | "lastSentAt">, now = new Date()): Promise<void> {
  const state = await loadAutoRenew(store);
  const at = now.toISOString();
  state.rules = [...state.rules.filter((r) => r.id !== rule.id), { ...rule, addedAt: at, lastSentAt: at }];
  state.events.unshift({ at, id: rule.id, drug: rule.drug, outcome: "sent", detail: `Auto-renew turned on: ${rule.quantity} × ${rule.packageText}` });
  await save(store, state);
}

/** Stops auto-renewing a medicine. Resolves to whether it had a rule. */
export async function stopRule(store: SettingStore, id: string): Promise<boolean> {
  const state = await loadAutoRenew(store);
  const rule = state.rules.find((r) => r.id === id);
  if (!rule) return false;
  state.rules = state.rules.filter((r) => r.id !== id);
  await save(store, state);
  return true;
}

/**
 * One check: asks for a renewal of every rule that is due. Resolves to what
 * was done, in rule order, as also added to the front of the log.
 */
export async function runAutoRenew(store: SettingStore, opts: { loggedIn: boolean; client?: RenewalClient; now?: Date; cooldownMs?: number }): Promise<AutoRenewEvent[]> {
  const now = opts.now ?? new Date();
  const cooldown = opts.cooldownMs ?? cooldownMs();
  const state = await loadAutoRenew(store);
  if (!state.rules.length) return [];
  const due = state.rules.filter((r) => nextDue(r, cooldown).getTime() <= now.getTime());
  const at = now.toISOString();
  const events: AutoRenewEvent[] = [];
  const event = (rule: AutoRenewRule, outcome: AutoRenewEvent["outcome"], detail: string) => events.push({ at, id: rule.id, drug: rule.drug, outcome, detail });
  if (due.length && !opts.loggedIn) {
    for (const rule of due) event(rule, "missed", "Not logged in with MitID, so nothing was sent. It is tried again after the next login.");
  } else if (due.length) {
    let listed: Awaited<ReturnType<typeof renewalOverview>> | null = null;
    try {
      listed = await renewalOverview(opts.client);
    } catch (err) {
      for (const rule of due) event(rule, "failed", `Could not read the renewal list: ${(err as Error).message}`);
    }
    for (const rule of listed ? due : []) {
      const m = listed?.medicines.find((x) => x.id === rule.id);
      if (!m) {
        event(rule, "skipped", "Not on the renewal list now: a renewal of it may already be being handled, or the prescription has ended.");
        continue;
      }
      if (!m.renewable) {
        event(rule, "skipped", m.reason ?? "sundhed.dk does not offer to renew it now.");
        continue;
      }
      try {
        const r = await sendRenewal({ id: rule.id, packageNumber: rule.packageNumber, quantity: rule.quantity }, opts.client);
        rule.lastSentAt = at;
        event(rule, "sent", `Asked the GP to renew it: ${r.quantity} × ${r.package.text}`);
      } catch (err) {
        event(rule, "failed", err instanceof RenewalError ? err.message : `sundhed.dk did not take the request: ${(err as Error).message}`);
      }
    }
  }
  state.lastCheckAt = at;
  state.events = [...events, ...state.events];
  await save(store, state);
  return events;
}

const running = new WeakMap<SavedCopy, Promise<unknown>>();

/** Runs a check for one person against their own session; one at a time per person. */
export function checkCopy(copy: SavedCopy, log: (line: string) => void = () => {}): Promise<unknown> {
  const busy = running.get(copy);
  if (busy) return busy;
  const run = (async () => {
    const { loggedIn } = await copy.session.status().catch(() => ({ loggedIn: false }));
    const events = await asOwner(copy, () => runAutoRenew(copy, { loggedIn }));
    // Counts only: drug names stay out of the log.
    if (events.length) log(`auto-renew: ${events.filter((e) => e.outcome === "sent").length} sent, ${events.filter((e) => e.outcome !== "sent").length} not`);
  })()
    .catch((err: unknown) => log(`auto-renew check failed: ${(err as Error).message}`))
    .finally(() => running.delete(copy));
  running.set(copy, run);
  return run;
}

/**
 * Checks each loaded person's rules once a day (looked at every hour), and a
 * minute after each login, once sync has had a moment to start.
 */
export function startAutoRenew(copies: () => SavedCopy[], copyOf: (session: SundhedSession) => SavedCopy | undefined, log: (line: string) => void): void {
  const tick = async () => {
    for (const copy of copies()) {
      const { lastCheckAt, rules } = await loadAutoRenew(copy).catch(() => ({ lastCheckAt: undefined, rules: [] }));
      if (rules.length && (!lastCheckAt || Date.now() - Date.parse(lastCheckAt) >= DAY)) await checkCopy(copy, log);
    }
  };
  setInterval(() => void tick(), 60 * 60_000).unref();
  onLogin((session) => {
    setTimeout(() => {
      const copy = copyOf(session);
      if (copy) void checkCopy(copy, log);
    }, 60_000).unref();
  });
}
