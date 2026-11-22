// Hosted entry point (Railway, Fly, Docker), now passive. SundhedMCP runs only
// locally over stdio (src/stdio.ts): hosted, it serves one page that says so,
// with no MCP endpoint, no OAuth, no browser and no MitID login. The hosted
// code (hosted.ts) starts only when SUNDHEDMCP_HOSTED=1: for your own machine
// behind a tunnel, never as a public service.
if (process.env.SUNDHEDMCP_HOSTED === "1") {
  await import("./hosted.ts");
} else {
  await import("./passive.ts");
}
