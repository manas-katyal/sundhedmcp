// Background sync: while the sundhed.dk session is live, fetches each part of
// the record again on its own interval, so the saved copy is close to current
// when sundhed.dk ends the session.
//
// - Right after each MitID login the whole record is fetched; after that one
//   part at a time, and never while another fetch runs.
// - Like every call, it only reads (GET).
// - Each part has its own interval, with jitter. A part that fails is tried
//   again sooner, then less often while it keeps failing.
// - When sundhed.dk has ended the session, sync waits for the next login.
//
// Env:
//   SUNDHEDMCP_SYNC=0  turn it off; the copy is then fetched after each login only
import { onLogin } from "@sundhedmcp/session";
import { PART_NAMES, type PartName, type RefreshResult, refresh } from "./snapshot.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const SYNC_INTERVALS_MS: Record<PartName, number> = {
  summary: HOUR,
  medicationCard: HOUR,
  prescriptions: HOUR,
  labResults: 6 * HOUR,
  vaccinations: 24 * HOUR,
  referrals: 24 * HOUR,
};

/** The first retry after a failure; it doubles up to four intervals. */
const RETRY_MS = 10 * MINUTE;
const TICK_MS = MINUTE;

export interface PartSyncStatus {
  everyMinutes: number;
  /** ISO time, or null while sync waits for a login. */
  nextRun: string | null;
  failures: number;
}

export interface SyncStatus {
  enabled: boolean;
  /** The session is live and parts are being fetched on schedule. */
  active: boolean;
  parts: Record<PartName, PartSyncStatus>;
}

export interface SyncDeps {
  refresh: (parts?: readonly PartName[]) => Promise<RefreshResult>;
  now?: () => number;
  random?: () => number;
}

export interface Sync {
  /** After a MitID login: fetch everything, then schedule each part. */
  loggedIn(): Promise<void>;
  /** Runs the part that is most overdue, if any. */
  tick(): Promise<void>;
  status(): SyncStatus;
}

export function createSync(deps: SyncDeps, enabled = true): Sync {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const state = Object.fromEntries(PART_NAMES.map((p) => [p, { nextRunAt: 0, failures: 0 }])) as Record<PartName, { nextRunAt: number; failures: number }>;
  let active = false;
  let busy = false;

  // ±10%, so the parts drift apart instead of all running on the same tick.
  const jitter = (ms: number) => Math.round(ms * (0.9 + 0.2 * random()));

  function schedule(result: RefreshResult, parts: readonly PartName[]): void {
    if (result.sessionEnded) {
      active = false;
      return;
    }
    active = enabled;
    for (const part of parts) {
      const s = state[part];
      const every = SYNC_INTERVALS_MS[part];
      s.failures = result.failed.includes(part) ? s.failures + 1 : 0;
      s.nextRunAt = now() + jitter(s.failures ? Math.min(RETRY_MS * 2 ** (s.failures - 1), 4 * every) : every);
    }
  }

  async function run(parts: readonly PartName[]): Promise<void> {
    busy = true;
    try {
      schedule(await deps.refresh(parts), parts);
    } finally {
      busy = false;
    }
  }

  return {
    loggedIn: () => run(PART_NAMES),
    async tick() {
      if (!active || busy) return;
      const due = PART_NAMES.filter((p) => state[p].nextRunAt <= now()).sort((a, b) => state[a].nextRunAt - state[b].nextRunAt);
      if (due[0]) await run([due[0]]);
    },
    status: () => ({
      enabled,
      active,
      parts: Object.fromEntries(
        PART_NAMES.map((p) => [
          p,
          { everyMinutes: SYNC_INTERVALS_MS[p] / MINUTE, nextRun: active ? new Date(state[p].nextRunAt).toISOString() : null, failures: state[p].failures },
        ]),
      ) as Record<PartName, PartSyncStatus>,
    }),
  };
}

let sync: Sync | null = null;

/** Fetches the record after each login, and keeps it current while the session lasts. */
export function startSync(env: NodeJS.ProcessEnv = process.env): void {
  if (sync) return;
  const enabled = env.SUNDHEDMCP_SYNC?.trim() !== "0";
  const instance = createSync({ refresh }, enabled);
  sync = instance;
  const fail = (err: unknown) => console.error(`[sync] failed: ${(err as Error).message}`);
  onLogin(() => void instance.loggedIn().catch(fail));
  if (enabled) setInterval(() => void instance.tick().catch(fail), TICK_MS).unref();
}

export const syncStatus = (): SyncStatus | null => sync?.status() ?? null;
