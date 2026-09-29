// Hosted mode: HTTP with OAuth, a headless browser, and the /connect page for
// logging in with MitID. Started by `sundhedmcp serve` (your own computer as
// the server, with the setup guide) or by server.ts when SUNDHEDMCP_HOSTED=1.
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { config, passwordConfigured, rememberEnvPassword, setupProblems } from "./config.ts";
import { configureHosted, disconnect, onLogin } from "./session.ts";
import { persistTo, refresh } from "./snapshot.ts";
import { createApp } from "./app.ts";
import type { GuideOptions } from "./guide.ts";

export interface HostedOptions {
  /** Interface to listen on; `serve` keeps it to this computer. */
  host?: string;
  guide?: Omit<GuideOptions, "onPublicUrl">;
}

export function startHosted(opts: HostedOptions = {}): Promise<void> {
  configureHosted(config.baseUrl);
  // After each MitID login, fetch the whole record and keep a copy on disk.
  persistTo(join(config.dataDir, "snapshot.json"));
  onLogin(() => void refresh().catch((err) => console.error(`[snapshot] failed: ${(err as Error).message}`)));
  if (rememberEnvPassword()) console.log("[sundhed] stored a hash of ADMIN_PASSWORD on the volume; the variable can now be removed");

  // The OAuth issuer is the public address, so when Funnel gives us one the
  // app is built again around it.
  const build = () =>
    createApp(
      opts.guide && {
        ...opts.guide,
        onPublicUrl: (url) => {
          if (url === config.baseUrl) return;
          console.log(`[sundhed] public address is now ${url}`);
          config.baseUrl = url;
          configureHosted(url);
          app = build();
        },
      },
    );
  let app = build();
  const httpServer = createHttpServer((req, res) => app(req, res));

  // Take the browser, and the session in it, down with the process.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await Promise.race([disconnect(), new Promise((r) => setTimeout(r, 3_000))]);
      process.exit(0);
    });
  }

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, opts.host ?? "0.0.0.0", () => {
      console.log(`[sundhed] listening on ${opts.host ?? "0.0.0.0"}:${config.port}, public URL ${config.baseUrl}`);
      const problems = setupProblems();
      if (problems.length) console.log("[sundhed] not configured:", problems);
      if (!passwordConfigured()) console.log(`[sundhed] no password yet: open ${config.baseUrl} to choose one`);
      resolve();
    });
  });
}

// Run directly (server.ts with SUNDHEDMCP_HOSTED=1): listen on every interface.
if (process.env.SUNDHEDMCP_HOSTED === "1" && !process.env.SUNDHEDMCP_SERVE) await startHosted();
