#!/usr/bin/env node
// `sundhedmcp` runs locally over stdio for an MCP client. `sundhedmcp serve`
// makes this computer the server, for the claude.ai connector and your phone.
// Requires Node 24 or newer.
const [major] = process.versions.node.split(".").map(Number);
if (major < 24) {
  console.error(`SundhedMCP needs Node 24 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}
await import(process.argv[2] === "serve" ? "../dist/lib/serve.js" : "../dist/lib/stdio.js");
