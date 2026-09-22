// Hosted mode only. Local (stdio) mode needs no configuration.
// Everything comes from environment variables; Railway sets them per service.
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
  dataDir: env.DATA_DIR ?? "./data",
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

/** What is missing before the hosted server can run safely. */
export function setupProblems(): string[] {
  const problems: string[] = [];
  if (config.adminPassword.length < 12) problems.push("ADMIN_PASSWORD must be set to at least 12 characters");
  if (!/^https?:\/\//.test(config.baseUrl)) problems.push("BASE_URL must start with http:// or https://");
  return problems;
}
