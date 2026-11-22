// Starts `sundhedmcp serve` whenever you log in to your computer, so the
// claude.ai connector works whenever the computer is on. macOS (launchd) and
// Linux (systemd --user); elsewhere the guide shows the command to run instead.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LABEL = "dk.sundhedmcp.serve";

function target(): { kind: "launchd" | "systemd"; path: string } | null {
  if (process.platform === "darwin") return { kind: "launchd", path: join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`) };
  if (process.platform === "linux") return { kind: "systemd", path: join(homedir(), ".config", "systemd", "user", "sundhedmcp.service") };
  return null;
}

export const autostartSupported = () => target() !== null;
export const autostartInstalled = () => {
  const t = target();
  return t ? existsSync(t.path) : false;
};

const xml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** The command that started this server, so the login agent starts the same one. */
function command(): string[] {
  return [process.execPath, process.argv[1]!, "serve", "--no-open"];
}

function sh(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => execFile(cmd, args, () => resolve()));
}

export async function installAutostart(env: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const t = target();
  if (!t) return { ok: false, message: "Not supported on this system." };
  mkdirSync(dirname(t.path), { recursive: true });
  const cmd = command();
  if (t.kind === "launchd") {
    const logs = join(homedir(), ".sundhedmcp", "serve.log");
    const envXml = Object.entries(env).map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`).join("");
    writeFileSync(
      t.path,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${cmd.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
<key>EnvironmentVariables</key><dict>${envXml}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>StandardOutPath</key><string>${xml(logs)}</string>
<key>StandardErrorPath</key><string>${xml(logs)}</string>
</dict></plist>
`,
    );
    // Loaded at the next login; not now, since this server is already running.
    return { ok: true, message: `Installed ${t.path}. It starts SundhedMCP each time you log in.` };
  }
  const envLines = Object.entries(env).map(([k, v]) => `Environment=${k}=${v}`).join("\n");
  writeFileSync(
    t.path,
    `[Unit]
Description=SundhedMCP (your own sundhed.dk record, for your AI)

[Service]
ExecStart=${cmd.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}
${envLines}
Restart=on-failure

[Install]
WantedBy=default.target
`,
  );
  await sh("systemctl", ["--user", "daemon-reload"]);
  await sh("systemctl", ["--user", "enable", "sundhedmcp.service"]);
  return { ok: true, message: `Installed ${t.path}. It starts SundhedMCP each time you log in.` };
}
