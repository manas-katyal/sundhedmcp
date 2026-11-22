// Multi-user hosted mode: one sundhed.dk session and one saved copy per
// signed-in person, created on their first request. A tool call or a /connect
// page only ever reaches the session and copy of the person who made it.
// Their copy is stored under their callerId as owner id, so the storage key
// derived for one person never opens another's rows (storage-crypto.ts).
import { SundhedSession } from "@sundhedmcp/session";
import { type Caller, callerId } from "./oidc.ts";
import { SavedCopy } from "./snapshot.ts";
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
    const id = callerId(caller);
    let copy = this.copies.get(id);
    if (!copy) {
      copy = (async () => {
        // Only the start of the id goes into logs: enough to tell people apart.
        const created = new SavedCopy(new SundhedSession(`user ${id.slice(0, 8)}`));
        if (this.storage) await created.useStorage(this.storage.forOwner(id));
        this.bySession.set(created.session, created);
        return created;
      })();
      copy.catch(() => this.copies.delete(id));
      this.copies.set(id, copy);
    }
    return copy;
  }

  /** The copy that belongs to a session, for sync after a login. */
  copyOf(session: SundhedSession): SavedCopy | undefined {
    return this.bySession.get(session);
  }

  /** Closes every person's browser. */
  async disconnectAll(): Promise<void> {
    await Promise.all([...this.bySession.keys()].map((session) => session.disconnect()));
  }
}
