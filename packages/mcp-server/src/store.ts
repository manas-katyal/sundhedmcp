// OAuth state for hosted mode: registered clients, pending codes and hashed
// tokens, in one JSON file. Nothing from sundhed.dk is ever stored.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

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

  constructor(path = config.statePath) {
    this.path = path;
    this.data = existsSync(path) ? { ...empty(), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<StoreData>) } : empty();
  }

  /** Mutate under a callback and persist once. */
  update<T>(fn: (d: StoreData) => T): T {
    const result = fn(this.data);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
    return result;
  }
}

let instance: Store | null = null;
export const store = (): Store => (instance ??= new Store());
