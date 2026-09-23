// Hosted entry point (Railway, Fly, Docker): HTTP with OAuth, a headless
// browser, and the /connect page for logging in with MitID.
import { createServer as createHttpServer } from "node:http";
import { config, passwordConfigured, rememberEnvPassword, setupProblems } from "./config.ts";
import { configureHosted, disconnect } from "./session.ts";
import { createApp } from "./app.ts";

configureHosted(config.baseUrl);
if (rememberEnvPassword()) console.log("[sundhed] stored a hash of ADMIN_PASSWORD on the volume; the variable can now be removed");
const httpServer = createHttpServer(createApp());
httpServer.listen(config.port, () => {
  console.log(`[sundhed] listening on http://0.0.0.0:${config.port}, public URL ${config.baseUrl}`);
  const problems = setupProblems();
  if (problems.length) console.log("[sundhed] not configured:", problems);
  if (!passwordConfigured()) console.log(`[sundhed] no password yet: open ${config.baseUrl} to choose one`);
});

// Take the browser, and the session in it, down with the process.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await Promise.race([disconnect(), new Promise((r) => setTimeout(r, 3_000))]);
    process.exit(0);
  });
}
