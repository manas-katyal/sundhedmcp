// OAuth state for hosted mode: registered clients, pending codes and hashed
// tokens. Nothing from sundhed.dk is stored here. With storage it is one
// encrypted row in the database (an oauth.json from an earlier version is
// moved there on start and deleted); without, one JSON file.
//
// Reads and writes stay synchronous for the OAuth provider: the row is
// loaded once at start, and each change is written behind, in order.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";
import type { OwnerStorage } from "./storage.ts";

export interface OAuthClient {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  client_name?: string;
  [key: string]: unknown;
}

export interface AuthCode {
  client_id: string;
  code_challenge: string;
  redirect_uri: string;
  resource?: string;
  scopes: string[];
  expires: number;
}

export interface Token {
  kind: "access" | "refresh";
  client_id: string;
  scopes: string[];
  expires: number;
  resource?: string;
}

export interface StoreData {
  clients: Record<string, OAuthClient>;
  codes: Record<string, AuthCode>;
  /** Keyed by sha256 of the token value. */
  tokens: Record<string, Token>;
  /** Fingerprint of the admin password the tokens were issued under. */
  password_fingerprint?: string;
}

const empty = (): StoreData => ({ clients: {}, codes: {}, tokens: {} });

export class Store {
  readonly path: string;
  data: StoreData;
  private storage: OwnerStorage | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(path = config.statePath) {
    this.path = path;
    this.data = existsSync(path) ? { ...empty(), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<StoreData>) } : empty();
  }

  /** Keeps the state in the database from now on, moving the file there first. */
  async useStorage(storage: OwnerStorage): Promise<void> {
    const row = await storage.get("oauth_state", "current");
    if (row) this.data = { ...empty(), ...(row.data as Partial<StoreData>) };
    else await storage.put([{ kind: "oauth_state", id: "current", data: this.data }]);
    this.storage = storage;
    rmSync(this.path, { force: true });
  }

  /** Mutate under a callback and persist once. */
  update<T>(fn: (d: StoreData) => T): T {
    const result = fn(this.data);
    const storage = this.storage;
    if (storage) {
      const data = structuredClone(this.data);
      this.writes = this.writes
        .then(() => storage.put([{ kind: "oauth_state", id: "current", data }]))
        .then(
          () => {},
          (err: unknown) => console.error(`[sundhed] could not store the OAuth state: ${(err as Error).message}`),
        );
      return result;
    }
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
    return result;
  }

  /** Resolves once every change so far is stored. */
  flush(): Promise<void> {
    return this.writes;
  }
}

let instance: Store | null = null;
export const store = (): Store => (instance ??= new Store());
