// Multi-user hosted mode: one sundhed.dk session and one saved copy per
// signed-in person, created on their first request. A tool call or a /connect
// page only ever reaches the session and copy of the person who made it.
// Their copy is stored under their callerId as owner id, so the storage key
// derived for one person never opens another's rows (storage-crypto.ts).
import { SundhedSession } from "@sundhedmcp/session";
import { type Caller, callerId } from "./oidc.ts";
import { LOGIN_SETTING, SavedCopy } from "./snapshot.ts";
import type { Storage } from "./storage.ts";

export class Users {
  private readonly storage: Storage | null;
  private readonly copies = new Map<string, Promise<SavedCopy>>();
  private readonly bySession = new Map<SundhedSession, SavedCopy>();

  constructor(storage: Storage | null) {
    this.storage = storage;
  }

  /** The person's own copy (and through it their session), loaded from storage on first use. */
  get(caller: Pick<Caller, "issuer" | "sub">): Promise<SavedCopy> {
    return this.byId(callerId(caller));
  }

  /** The copy of a callerId, for work no request asks for (a kept login, auto-renew). */
  byId(id: string): Promise<SavedCopy> {
    let copy = this.copies.get(id);
    if (!copy) {
      copy = (async () => {
        // Only the start of the id goes into logs: enough to tell people apart.
        const created = new SavedCopy(new SundhedSession(`user ${id.slice(0, 8)}`));
        if (this.storage) {
          await created.useStorage(this.storage.forOwner(id));
          created.keepLogin();
        }
        this.bySession.set(created.session, created);
        return created;
      })();
      copy.catch(() => this.copies.delete(id));
      this.copies.set(id, copy);
    }
    return copy;
  }

  /** How many people's copies are loaded. */
  get loaded(): number {
    return this.copies.size;
  }

  /** The copy that belongs to a session, for sync after a login. */
  copyOf(session: SundhedSession): SavedCopy | undefined {
    return this.bySession.get(session);
  }

  /** Every loaded copy. */
  all(): SavedCopy[] {
    return [...this.bySession.values()];
  }

  /** After a restart: loads the people who kept their login, and logs them in again with it. */
  async resumeLogins(): Promise<number> {
    if (!this.storage) return 0;
    let resumed = 0;
    for (const id of await this.storage.ownersWith("setting", LOGIN_SETTING)) {
      if (await (await this.byId(id)).resumeLogin().catch(() => false)) resumed++;
    }
    return resumed;
  }

  /** Closes every person's browser at shutdown; kept logins stay. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.bySession.keys()].map((session) => session.close()));
  }
}
