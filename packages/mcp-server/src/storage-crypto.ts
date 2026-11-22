// Encryption for the stored record. Every row is sealed with AES-256-GCM
// before it reaches the database, so a database dump or backup holds only
// ciphertext.
//
// One storage key per server; each owner gets their own key derived from it
// (HKDF over the owner id), and every row is bound to its owner, kind and id
// as associated data, so a row copied to another owner or id fails to open
// instead of showing up as theirs.
//
// Rotating: the current key seals, and earlier keys (`previous`) still open
// what they sealed. Each payload names its key by a short id derived from it,
// so rows still sealed with an earlier key can be found and sealed again.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const VERSION = "v1";
const KEY_BYTES = 32;

export class StorageKeyError extends Error {
  override name = "StorageKeyError";
}

/** The key that seals, and the earlier ones that still open. */
export interface StorageKeys {
  current: Buffer;
  previous: Buffer[];
}

export interface OwnerCipher {
  seal(aad: string, plaintext: string): string;
  open(aad: string, sealed: string): string;
  /** Keyed hash, to spot unchanged rows without storing plaintext. */
  hash(plaintext: string): string;
  /** How every payload sealed with the current key starts. */
  readonly currentPrefix: string;
}

/** A short public id for a key, so a payload can say which key sealed it. */
export function keyId(key: Buffer): string {
  return createHmac("sha256", key).update("sundhedmcp-key-id").digest("hex").slice(0, 8);
}

export function ownerCipher(keys: Buffer | StorageKeys, ownerId: string): OwnerCipher {
  const ring = Buffer.isBuffer(keys) ? { current: keys, previous: [] } : keys;
  const derived = [ring.current, ...ring.previous].map((storageKey) => {
    const derive = (purpose: string) => Buffer.from(hkdfSync("sha256", storageKey, "sundhedmcp-storage", `${purpose}:${ownerId}`, KEY_BYTES));
    return { id: keyId(storageKey), seal: derive("seal"), hash: derive("hash") };
  });
  const current = derived[0] as (typeof derived)[number];
  const prefix = `${VERSION}.${current.id}.`;
  return {
    currentPrefix: prefix,
    seal(aad, plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", current.seal, iv);
      cipher.setAAD(Buffer.from(aad));
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return `${prefix}${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
    },
    open(aad, sealed) {
      const parts = sealed.split(".");
      if (parts[0] !== VERSION || parts.length !== 3 || !parts[2]) throw new StorageKeyError("Unknown payload format.");
      // The named key first; another with the same short id after it.
      const candidates = [...derived.filter((k) => k.id === parts[1]), ...derived.filter((k) => k.id !== parts[1])];
      const raw = Buffer.from(parts[2], "base64");
      for (const key of candidates) {
        const decipher = createDecipheriv("aes-256-gcm", key.seal, raw.subarray(0, 12));
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(raw.subarray(12, 28));
        try {
          return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
        } catch {}
      }
      throw new StorageKeyError("A stored row could not be decrypted. None of the storage keys is the one it was written with.");
    },
    hash(plaintext) {
      return createHmac("sha256", current.hash).update(plaintext).digest("base64url");
    },
  };
}

/**
 * The current key and the earlier ones. The current key is
 * SUNDHEDMCP_STORAGE_KEY (base64, 32 bytes) when set, otherwise a key file
 * created on first use. Earlier keys are SUNDHEDMCP_STORAGE_PREVIOUS_KEYS
 * (separated by commas or whitespace), plus the key file when
 * SUNDHEDMCP_STORAGE_KEY is set, since that file holds the key used before.
 * Losing the key makes the stored record unreadable.
 */
export function loadStorageKeys(env: NodeJS.ProcessEnv, keyFile: string): StorageKeys {
  const fromFile = readKeyFile(keyFile);
  let current: Buffer;
  if (env.SUNDHEDMCP_STORAGE_KEY) current = decodeKey(env.SUNDHEDMCP_STORAGE_KEY, "SUNDHEDMCP_STORAGE_KEY");
  else current = fromFile ?? createKeyFile(keyFile);
  const previous = (env.SUNDHEDMCP_STORAGE_PREVIOUS_KEYS ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((encoded) => decodeKey(encoded, "SUNDHEDMCP_STORAGE_PREVIOUS_KEYS"));
  if (env.SUNDHEDMCP_STORAGE_KEY && fromFile) previous.push(fromFile);
  const seen = new Set([current.toString("base64")]);
  return {
    current,
    previous: previous.filter((key) => {
      const encoded = key.toString("base64");
      if (seen.has(encoded)) return false;
      seen.add(encoded);
      return true;
    }),
  };
}

function readKeyFile(keyFile: string): Buffer | null {
  try {
    return decodeKey(readFileSync(keyFile, "utf8").trim(), keyFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function createKeyFile(keyFile: string): Buffer {
  const key = randomBytes(KEY_BYTES);
  mkdirSync(dirname(keyFile), { recursive: true });
  // `wx`: if another process created it meanwhile, use theirs.
  try {
    writeFileSync(keyFile, `${key.toString("base64")}\n`, { mode: 0o600, flag: "wx" });
    return key;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    return readKeyFile(keyFile) as Buffer;
  }
}

function decodeKey(encoded: string, source: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) throw new StorageKeyError(`${source} must be ${KEY_BYTES} bytes, base64-encoded.`);
  return key;
}
