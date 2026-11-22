// The two SQL backends storage runs on: SQLite (node:sqlite, the default) and
// PostgreSQL (pg), each loaded only when used. Both take `$1`-style
// placeholders and return plain rows, so storage.ts writes each query once.
import { chmodSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";

export type SqlValue = string | number | null;
export type SqlRow = Record<string, unknown>;

export interface SqlDriver {
  readonly dialect: "sqlite" | "postgres";
  all<T extends SqlRow = SqlRow>(query: string, params?: SqlValue[]): Promise<T[]>;
  /** Resolves to the number of rows the statement changed. */
  run(query: string, params?: SqlValue[]): Promise<number>;
  /** Runs `fn` in one transaction; it rolls back when `fn` throws. */
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function sqliteDriver(path: string): Promise<SqlDriver> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  // The content is encrypted, but when the record was fetched is not.
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  // SQLite binds `?1`, not `$1`.
  const prepare = (query: string) => db.prepare(query.replace(/\$(\d+)/g, "?$1"));

  const direct: Omit<SqlDriver, "transaction" | "close"> = {
    dialect: "sqlite",
    all: async <T extends SqlRow>(query: string, params: SqlValue[] = []) => prepare(query).all(...(params as SQLInputValue[])) as T[],
    run: async (query, params = []) => Number(prepare(query).run(...(params as SQLInputValue[])).changes),
  };

  // One connection: a transaction must not interleave with other calls, so
  // every call waits its turn.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };
  const inTransaction: SqlDriver = { ...direct, transaction: (fn) => fn(inTransaction), close: async () => {} };

  return {
    dialect: "sqlite",
    all: (query, params) => serial(() => direct.all(query, params)),
    run: (query, params) => serial(() => direct.run(query, params)),
    transaction: (fn) =>
      serial(async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn(inTransaction);
          db.exec("COMMIT");
          return result;
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      }),
    close: async () => {
      await queue;
      db.close();
    },
  };
}

interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: SqlRow[]; rowCount: number | null }>;
}

export async function postgresDriver(url: string): Promise<SqlDriver> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  const wrap = (conn: PgQueryable, inTransaction: boolean): SqlDriver => ({
    dialect: "postgres",
    all: async <T extends SqlRow>(query: string, params: SqlValue[] = []) => (await conn.query(query, params)).rows as T[],
    run: async (query, params = []) => (await conn.query(query, params)).rowCount ?? 0,
    transaction: async (fn) => {
      if (inTransaction) return fn(wrap(conn, true));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client, true));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  });
  return wrap(pool, false);
}
