// Hosted mode: HTTP with OAuth, a headless browser, and the /connect page for
// logging in with MitID. Started by `sundhedmcp serve` (your own computer as
// the server, with the setup guide) or by server.ts when SUNDHEDMCP_HOSTED=1.
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { config, MIN_API_TOKEN_LENGTH, passwordConfigured, rememberEnvPassword, setupProblems } from "./config.ts";
import { configureHosted, disconnect } from "@sundhedmcp/session";
import { useStorage } from "./snapshot.ts";
import { startSync } from "./sync.ts";
import { openStorage, SERVER_OWNER_ID, SINGLE_OWNER_ID } from "./storage.ts";
import { store } from "./store.ts";
import { createApp, type MultiUser } from "./app.ts";
import { resolveOidc } from "./oidc.ts";
import { Users } from "./users.ts";
import type { GuideOptions } from "./guide.ts";
import { VERSION } from "./mcp.ts";
import { observeGauge, startTelemetry, telemetryConfig } from "./telemetry.ts";

export interface HostedOptions {
  /** Interface to listen on; `serve` keeps it to this computer. */
  host?: string;
  guide?: Omit<GuideOptions, "onPublicUrl">;
}

export async function startHosted(opts: HostedOptions = {}): Promise<void> {
  // Several people, each signed in with the identity provider; refuses to start when half configured.
  const oidc = resolveOidc(process.env, config.apiTokens);
  // OpenTelemetry, before anything records (telemetry.ts). Off unless SUNDHEDMCP_OTEL=1.
  const otel = telemetryConfig(process.env, VERSION);
  const telemetry = otel ? await startTelemetry(otel) : null;
  if (telemetry) console.log(`[sundhed] telemetry: ${[...telemetry.config.signals].join(", ") || "no signals"} to ${telemetry.config.endpoint}`);
  configureHosted(config.baseUrl);
  // After each MitID login, fetch the whole record and keep an encrypted copy,
  // kept current while the session lasts (sync.ts).
  const storage = await openStorage(config.dataDir, "sqlite");
  if (storage) console.log(`[sundhed] storage: ${storage.info.type} at ${storage.info.location}`);
  let multi: MultiUser | undefined;
  if (oidc) {
    const users = new Users(storage);
    multi = { oidc, users };
    startSync(process.env, (session) => users.copyOf(session));
    observeGauge("sundhedmcp.copies.loaded", "People whose saved copy is loaded in this process.", () => users.loaded);
    console.log(`[sundhed] several people: signing in with ${oidc.issuer}`);
  } else {
    if (storage) {
      await useStorage(storage.forOwner(SINGLE_OWNER_ID), join(config.dataDir, "snapshot.json"));
      await store().useStorage(storage.forOwner(SERVER_OWNER_ID));
    }
    startSync();
    if (rememberEnvPassword()) console.log("[sundhed] stored a hash of ADMIN_PASSWORD on the volume; the variable can now be removed");
  }

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
      multi,
    );
  let app = build();
  const httpServer = createHttpServer((req, res) => app(req, res));

  // Take the browser, and the session in it, down with the process.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await Promise.race([Promise.all([disconnect(), multi?.users.disconnectAll(), store().flush().then(() => storage?.close()), telemetry?.shutdown()]), new Promise((r) => setTimeout(r, 3_000))]);
      process.exit(0);
    });
  }

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, opts.host ?? "0.0.0.0", () => {
      console.log(`[sundhed] listening on ${opts.host ?? "0.0.0.0"}:${config.port}, public URL ${config.baseUrl}`);
      const problems = setupProblems();
      if (problems.length) console.log("[sundhed] not configured:", problems);
      if (!multi && !passwordConfigured()) console.log(`[sundhed] no password yet: open ${config.baseUrl} to choose one`);
      if (config.apiTokens.filter((t) => t.length >= MIN_API_TOKEN_LENGTH).length) console.log(`[sundhed] ${config.apiTokens.length} API token(s) accepted on /mcp`);
      resolve();
    });
  });
}

// Run directly (server.ts with SUNDHEDMCP_HOSTED=1): listen on every interface.
if (process.env.SUNDHEDMCP_HOSTED === "1" && !process.env.SUNDHEDMCP_SERVE) await startHosted();
