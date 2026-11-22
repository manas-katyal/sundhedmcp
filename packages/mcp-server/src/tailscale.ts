// Tailscale Funnel gives the server on your own computer a fixed public HTTPS
// address, so claude.ai (and the Claude app on your phone) can reach it while
// the computer is on. SundhedMCP only drives the tailscale CLI; nothing runs
// on a server of ours.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

const CANDIDATES = [
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
  "/usr/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "C:\\Program Files\\Tailscale\\tailscale.exe",
];

function binary(): string | null {
  // SUNDHEDMCP_TAILSCALE: a tailscale CLI somewhere else (or a stand-in for tests).
  if (process.env.SUNDHEDMCP_TAILSCALE) return process.env.SUNDHEDMCP_TAILSCALE;
  for (const path of CANDIDATES) if (existsSync(path)) return path;
  return null;
}

function run(args: string[], timeoutMs = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const bin = binary();
  if (!bin) return Promise.resolve({ ok: false, stdout: "", stderr: "tailscale not found" });
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) }));
  });
}

export interface TailscaleState {
  /** installed → loggedIn → funnel: each step needs the one before. */
  installed: boolean;
  loggedIn: boolean;
  /** https://<machine>.<tailnet>.ts.net once logged in. */
  url: string | null;
  /** True when Funnel already forwards that address to our port. */
  funnel: boolean;
}

export async function tailscaleState(port: number): Promise<TailscaleState> {
  if (!binary()) return { installed: false, loggedIn: false, url: null, funnel: false };
  const st = await run(["status", "--json"]);
  let dns = "";
  let running = false;
  try {
    const parsed = JSON.parse(st.stdout) as { BackendState?: string; Self?: { DNSName?: string } };
    running = parsed.BackendState === "Running";
    dns = String(parsed.Self?.DNSName ?? "").replace(/\.$/, "");
  } catch {}
  if (!running || !dns) return { installed: true, loggedIn: false, url: null, funnel: false };
  const url = `https://${dns}`;
  const fs = await run(["funnel", "status", "--json"]);
  let funnel = false;
  try {
    const parsed = JSON.parse(fs.stdout) as { AllowFunnel?: Record<string, boolean>; Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };
    const host = `${dns}:443`;
    const proxy = parsed.Web?.[host]?.Handlers?.["/"]?.Proxy ?? "";
    funnel = Boolean(parsed.AllowFunnel?.[host]) && new RegExp(`:${port}/?$`).test(proxy);
  } catch {}
  return { installed: true, loggedIn: true, url, funnel };
}

/**
 * Turns Funnel on for our port, in the background so it survives restarts.
 * When the tailnet has not allowed Funnel yet, tailscale answers with a link
 * to the admin console; that link is passed on for the person to open.
 */
export async function enableFunnel(port: number): Promise<{ ok: boolean; message: string; links: string[] }> {
  const res = await run(["funnel", "--bg", "--yes", String(port)], 30_000);
  const out = `${res.stdout}\n${res.stderr}`.trim();
  const links = [...new Set(out.match(/https:\/\/login\.tailscale\.com\/\S+/g) ?? [])];
  return { ok: res.ok, message: out.slice(0, 600), links };
}
