// Encrypted storage of the saved copy of the record, so it survives a restart
// of the server. Rows are keyed by owner: every read and write goes through
// `forOwner(ownerId)`. Until accounts arrive there is one owner, `default`.
//
// Env:
//   SUNDHEDMCP_STORAGE      `sqlite` (default where the copy is kept on disk),
//                           `postgres`, or `none` to keep it in memory only
//   SUNDHEDMCP_SQLITE_PATH  SQLite file (default <DATA_DIR>/sundhed.db)
//   SUNDHEDMCP_DATABASE_URL PostgreSQL connection URL; required for postgres
//   SUNDHEDMCP_STORAGE_KEY  base64 key the rows are encrypted with
//                           (default: generated into <DATA_DIR>/storage.key)
//   SUNDHEDMCP_STORAGE_PREVIOUS_KEYS  earlier keys, which still open the rows
//                           they sealed until reencrypt() seals them again
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadStorageKeys, type OwnerCipher, ownerCipher, type StorageKeys } from "./storage-crypto.ts";
import { postgresDriver, type SqlDriver, sqliteDriver } from "./storage-sql.ts";

/** The owner rows are stored under while there is only one person. */
export const SINGLE_OWNER_ID = "default";

/** What a stored row is: one part of the record, or one detail within a part. */
export const ITEM_KINDS = [
  "snapshot",
  "summary",
  "medication_card",
  "medication_detail",
  "prescriptions",
  "prescription",
  "vaccinations",
  "vaccination",
  "lab_results",
  "referrals",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ItemInput {
  kind: ItemKind;
  /** sundhed.dk's id for it, unique within the kind; `current` for a whole part. */
  id: string;
  /** As sundhed.dk returned it (after cleaning). Stored encrypted. */
  data: unknown;
}

export interface StoredItem {
  kind: ItemKind;
  id: string;
  /** Unix seconds. */
  firstSeenAt: number;
  updatedAt: number;
  data: unknown;
}

/** Which key seals an owner's rows, and how many still wait for it. */
export interface KeyStatus {
  keyId: string;
  previousKeys: number;
  /** Rows sealed with an earlier key. */
  stale: number;
}

export interface StorageInfo {
  type: "sqlite" | "postgres";
  /** Where it is, without credentials. */
  location: string;
}

export interface Storage {
  readonly info: StorageInfo;
  forOwner(ownerId: string): OwnerStorage;
  /** Seals every row not sealed with the current key again, after a key change. */
  reencrypt(): Promise<{ reencrypted: number; unreadable: number }>;
  close(): Promise<void>;
}

export class StorageConfigError extends Error {
  override name = "StorageConfigError";
}

/**
 * Opens and migrates the configured storage; null when it is turned off.
 * `fallback` is the type used when SUNDHEDMCP_STORAGE is not set.
 */
export async function openStorage(dataDir: string, fallback: "sqlite" | "none", env: NodeJS.ProcessEnv = process.env): Promise<Storage | null> {
  const type = env.SUNDHEDMCP_STORAGE?.trim() || fallback;
  if (type === "none") return null;
  if (type !== "sqlite" && type !== "postgres") throw new StorageConfigError(`SUNDHEDMCP_STORAGE must be sqlite, postgres or none, not "${type}".`);
  const keys = loadStorageKeys(env, join(dataDir, "storage.key"));
  if (type === "postgres") {
    const url = env.SUNDHEDMCP_DATABASE_URL;
    if (!url) throw new StorageConfigError("SUNDHEDMCP_STORAGE=postgres needs SUNDHEDMCP_DATABASE_URL.");
    return createStorage(await postgresDriver(url), keys, { type, location: redactUrl(url) });
  }
  const path = env.SUNDHEDMCP_SQLITE_PATH?.trim() || join(dataDir, "sundhed.db");
  mkdirSync(dirname(path), { recursive: true });
  return createStorage(await sqliteDriver(path), keys, { type, location: path });
}

export async function createStorage(driver: SqlDriver, storageKeys: Buffer | StorageKeys, info: StorageInfo): Promise<Storage> {
  await migrate(driver);
  const keys = Buffer.isBuffer(storageKeys) ? { current: storageKeys, previous: [] } : storageKeys;
  const forOwner = (ownerId: string) => new OwnerStorage(driver, ownerCipher(keys, ownerId), ownerId, keys.previous.length);
  return {
    info,
    forOwner,
    reencrypt: async () => {
      const result = { reencrypted: 0, unreadable: 0 };
      const owners = await driver.all<{ owner_id: string }>("SELECT DISTINCT owner_id FROM items ORDER BY owner_id");
      for (const { owner_id } of owners) {
        const done = await forOwner(owner_id).reencrypt();
        result.reencrypted += done.reencrypted;
        result.unreadable += done.unreadable;
      }
      return result;
    },
    close: () => driver.close(),
  };
}

export class OwnerStorage {
  readonly ownerId: string;
  private readonly db: SqlDriver;
  private readonly cipher: OwnerCipher;
  private readonly previousKeys: number;

  constructor(db: SqlDriver, cipher: OwnerCipher, ownerId: string, previousKeys = 0) {
    this.db = db;
    this.cipher = cipher;
    this.ownerId = ownerId;
    this.previousKeys = previousKeys;
  }

  /** Inserts new items and updates changed ones; unchanged ones are left alone. */
  async put(items: ItemInput[]): Promise<{ changed: number; unchanged: number }> {
    const now = Math.floor(Date.now() / 1000);
    let changed = 0;
    await this.db.transaction(async (tx) => {
      for (const item of items) {
        const plaintext = JSON.stringify(item.data ?? null);
        changed += await tx.run(
          `INSERT INTO items (owner_id, kind, id, content_hash, payload, first_seen_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (owner_id, kind, id) DO UPDATE SET
             content_hash = excluded.content_hash,
             payload = excluded.payload,
             updated_at = excluded.updated_at
           WHERE items.content_hash <> excluded.content_hash`,
          [this.ownerId, item.kind, item.id, this.cipher.hash(plaintext), this.cipher.seal(this.aad(item.kind, item.id), plaintext), now],
        );
      }
    });
    return { changed, unchanged: items.length - changed };
  }

  async get(kind: ItemKind, id: string): Promise<StoredItem | null> {
    const rows = await this.db.all<ItemRow>(`SELECT ${COLUMNS} FROM items WHERE owner_id = $1 AND kind = $2 AND id = $3`, [this.ownerId, kind, id]);
    return rows[0] ? this.decode(rows[0]) : null;
  }

  /** Every item of the kind, or every item, ordered by kind and id. */
  async list(kind?: ItemKind): Promise<StoredItem[]> {
    const rows = kind
      ? await this.db.all<ItemRow>(`SELECT ${COLUMNS} FROM items WHERE owner_id = $1 AND kind = $2 ORDER BY id`, [this.ownerId, kind])
      : await this.db.all<ItemRow>(`SELECT ${COLUMNS} FROM items WHERE owner_id = $1 ORDER BY kind, id`, [this.ownerId]);
    return rows.map((row) => this.decode(row));
  }

  /** Deletes the items of a kind whose id is not in `keep`. Resolves to how many. */
  async prune(kind: ItemKind, keep: string[]): Promise<number> {
    const stored = await this.db.all<{ id: string }>("SELECT id FROM items WHERE owner_id = $1 AND kind = $2", [this.ownerId, kind]);
    const wanted = new Set(keep);
    let deleted = 0;
    for (const { id } of stored) {
      if (!wanted.has(id)) deleted += await this.db.run("DELETE FROM items WHERE owner_id = $1 AND kind = $2 AND id = $3", [this.ownerId, kind, id]);
    }
    return deleted;
  }

  /** Deletes one kind, or everything this owner has stored. Resolves to how many. */
  delete(kind?: ItemKind): Promise<number> {
    return kind
      ? this.db.run("DELETE FROM items WHERE owner_id = $1 AND kind = $2", [this.ownerId, kind])
      : this.db.run("DELETE FROM items WHERE owner_id = $1", [this.ownerId]);
  }

  /** Which key seals this owner's rows. Reads no content. */
  async keyStatus(): Promise<KeyStatus> {
    const rows = await this.db.all<{ count: unknown }>("SELECT COUNT(*) AS count FROM items WHERE owner_id = $1 AND payload NOT LIKE $2", [
      this.ownerId,
      `${this.cipher.currentPrefix}%`,
    ]);
    return { keyId: this.cipher.currentPrefix.split(".")[1] ?? "", previousKeys: this.previousKeys, stale: Number(rows[0]?.count ?? 0) };
  }

  /** Seals this owner's rows not sealed with the current key again. */
  async reencrypt(): Promise<{ reencrypted: number; unreadable: number }> {
    let reencrypted = 0;
    let unreadable = 0;
    const rows = await this.db.all<{ kind: string; id: string; payload: string }>(
      "SELECT kind, id, payload FROM items WHERE owner_id = $1 AND payload NOT LIKE $2 ORDER BY kind, id",
      [this.ownerId, `${this.cipher.currentPrefix}%`],
    );
    for (const row of rows) {
      let plaintext: string;
      try {
        plaintext = this.cipher.open(this.aad(row.kind, row.id), row.payload);
      } catch {
        unreadable += 1;
        continue;
      }
      // Only if the row has not changed since it was read.
      reencrypted += await this.db.run("UPDATE items SET payload = $1, content_hash = $2 WHERE owner_id = $3 AND kind = $4 AND id = $5 AND payload = $6", [
        this.cipher.seal(this.aad(row.kind, row.id), plaintext),
        this.cipher.hash(plaintext),
        this.ownerId,
        row.kind,
        row.id,
        row.payload,
      ]);
    }
    return { reencrypted, unreadable };
  }

  private aad(kind: string, id: string): string {
    return `${this.ownerId}\n${kind}\n${id}`;
  }

  private decode(row: ItemRow): StoredItem {
    return {
      kind: row.kind,
      id: row.id,
      firstSeenAt: Number(row.first_seen_at),
      updatedAt: Number(row.updated_at),
      data: JSON.parse(this.cipher.open(this.aad(row.kind, row.id), row.payload)),
    };
  }
}

interface ItemRow {
  [column: string]: unknown;
  kind: ItemKind;
  id: string;
  first_seen_at: unknown;
  updated_at: unknown;
  payload: string;
}

const COLUMNS = "kind, id, first_seen_at, updated_at, payload";

/** Applied in order, once each. Never edit one that has shipped; add a new one. */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE items (
       owner_id TEXT NOT NULL,
       kind TEXT NOT NULL,
       id TEXT NOT NULL,
       content_hash TEXT NOT NULL,
       payload TEXT NOT NULL,
       first_seen_at BIGINT NOT NULL,
       updated_at BIGINT NOT NULL,
       PRIMARY KEY (owner_id, kind, id)
     )`,
  ],
];

async function migrate(db: SqlDriver): Promise<void> {
  await db.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)");
  await db.transaction(async (tx) => {
    // Two servers starting at once must not both migrate.
    if (tx.dialect === "postgres") await tx.run("SELECT pg_advisory_xact_lock(hashtext('sundhedmcp-migrate'))");
    const done = new Set((await tx.all<{ version: unknown }>("SELECT version FROM schema_migrations")).map((row) => Number(row.version)));
    for (const [index, statements] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (done.has(version)) continue;
      for (const statement of statements) await tx.run(statement);
      await tx.run("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)", [version, Math.floor(Date.now() / 1000)]);
    }
  });
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.password = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "postgres (URL could not be parsed)";
  }
}
