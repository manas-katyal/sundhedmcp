// Hosted mode only. Local (stdio) mode needs no configuration.
// Settings come from environment variables. The admin password can instead be
// chosen on the server's first-run page, and is then stored hashed on the volume.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = process.env;
const port = Number(env.PORT ?? 8080);

/** Public URL guessed from the platform when BASE_URL is not set. */
function detectBaseUrl(): string {
  if (env.BASE_URL) return env.BASE_URL.replace(/\/+$/, "");
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  if (env.FLY_APP_NAME) return `https://${env.FLY_APP_NAME}.fly.dev`;
  if (env.RENDER_EXTERNAL_URL) return env.RENDER_EXTERNAL_URL.replace(/\/+$/, "");
  return `http://localhost:${port}`;
}

export const config = {
  port,
  baseUrl: detectBaseUrl(),
  // Only OAuth clients and hashed tokens are stored here. Never health data.
  // An empty DATA_DIR (as a platform template may set) counts as unset.
  dataDir: env.DATA_DIR?.trim() || "./data",
  get statePath(): string {
    return join(this.dataDir, "oauth.json");
  },
  adminPassword: env.ADMIN_PASSWORD ?? "",
  // Hosts an OAuth client may send the sign-in back to. Stops a phishing link
  // from registering a client that redirects your authorization code elsewhere.
  allowedRedirectHosts: (env.ALLOWED_REDIRECT_HOSTS ?? "claude.ai,claude.com,chatgpt.com,cursor.com,vscode.dev,localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
};

export const MIN_PASSWORD_LENGTH = 12;

/** What is wrong with the configuration, beyond the password the first-run page asks for. */
export function setupProblems(): string[] {
  const problems: string[] = [];
  if (config.adminPassword && config.adminPassword.length < MIN_PASSWORD_LENGTH) problems.push(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (!/^https?:\/\//.test(config.baseUrl)) problems.push("BASE_URL must start with http:// or https://");
  return problems;
}

// --- Admin password: ADMIN_PASSWORD wins; otherwise the hash stored on the volume ---

interface Settings {
  admin_password_hash?: string;
}

const settingsPath = () => join(config.dataDir, "settings.json");

function readSettings(): Settings {
  try {
    return existsSync(settingsPath()) ? (JSON.parse(readFileSync(settingsPath(), "utf8")) as Settings) : {};
  } catch {
    return {};
  }
}

function writeSettings(settings: Settings): void {
  mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${settingsPath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  renameSync(tmp, settingsPath());
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 64).toString("base64")}`;
}

/** True once there is a password: from the environment or chosen on the first-run page. */
export function passwordConfigured(): boolean {
  return config.adminPassword.length >= MIN_PASSWORD_LENGTH || Boolean(readSettings().admin_password_hash);
}

export function checkPassword(password: string): boolean {
  if (config.adminPassword) {
    // Compare digests so the comparison takes the same time whatever the length.
    const a = createHash("sha256").update(password).digest();
    const b = createHash("sha256").update(config.adminPassword).digest();
    return timingSafeEqual(a, b);
  }
  const [scheme, salt, expected] = (readSettings().admin_password_hash ?? "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, Buffer.from(salt, "base64"), 64);
  const want = Buffer.from(expected, "base64");
  return actual.length === want.length && timingSafeEqual(actual, want);
}

/** Stores a new password hash. Only the first-run page calls this. */
export function setPassword(password: string): void {
  writeSettings({ ...readSettings(), admin_password_hash: hashPassword(password) });
}

/** Changes whenever the password does, so tokens issued under an old one can be revoked. */
export function passwordFingerprint(): string {
  return createHash("sha256").update(config.adminPassword || readSettings().admin_password_hash || "").digest("hex");
}

/**
 * Copies ADMIN_PASSWORD into the stored hash when there is none yet, so the
 * variable can be removed later (for example before making a template from
 * the project) without locking the owner out.
 */
export function rememberEnvPassword(): boolean {
  if (config.adminPassword.length < MIN_PASSWORD_LENGTH || readSettings().admin_password_hash) return false;
  setPassword(config.adminPassword);
  return true;
}
