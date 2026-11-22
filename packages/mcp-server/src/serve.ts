// `sundhedmcp serve`: your own computer becomes the server, so the claude.ai
// connector (and the Claude app on your phone) can use SundhedMCP while the
// computer is on. Opens the setup guide on first run.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export const SERVE_PORT = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR?.trim() || join(homedir(), ".sundhedmcp");
process.env.SUNDHEDMCP_SERVE = "1";
process.env.PORT = String(SERVE_PORT);
process.env.DATA_DIR = dataDir;

// Already running (the login agent, or an earlier `serve`): just open the guide.
const guideUrl = `http://localhost:${SERVE_PORT}/guide`;
const open = (url: string) => {
  if (process.argv.includes("--no-open")) return;
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  execFile(cmd as string, args as string[], () => {});
};
const running = await fetch(`http://127.0.0.1:${SERVE_PORT}/healthz`).then((r) => r.ok, () => false);
if (running) {
  console.log(`SundhedMCP is already running. Guide: ${guideUrl}`);
  open(guideUrl);
  process.exit(0);
}

// Use the Funnel address from the start when it is already on.
const { tailscaleState } = await import("./tailscale.ts");
const ts = await tailscaleState(SERVE_PORT);
if (ts.funnel && ts.url && !process.env.BASE_URL) process.env.BASE_URL = ts.url;

const { startHosted } = await import("./hosted.ts");
await startHosted({ host: "127.0.0.1", guide: { port: SERVE_PORT, env: { PORT: String(SERVE_PORT), DATA_DIR: dataDir, PATH: process.env.PATH ?? "" } } });
console.log(`SundhedMCP is running on this computer. Guide: ${guideUrl}`);
open(guideUrl);
