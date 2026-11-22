// Builds the published package: the three entry points, bundled with the
// workspace packages (@sundhedmcp/session, @sundhedmcp/client), which are not
// on npm. The npm dependencies stay external and are installed with the package.
// Chunks land next to the entry points, so `./assets/` and `./serve.js`
// resolve from import.meta.url the same way they do from src/.
import { cpSync, readFileSync, rmSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
const outdir = "dist/lib";

rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints: ["src/stdio.ts", "src/serve.ts", "src/server.ts"],
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node24",
  // A package name also covers its subpaths (@modelcontextprotocol/sdk/server/mcp.js).
  external: Object.keys(pkg.dependencies),
  logLevel: "warning",
});
cpSync("src/assets", `${outdir}/assets`, { recursive: true });
