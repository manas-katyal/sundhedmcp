#!/usr/bin/env node
// Runs SundhedMCP locally over stdio for an MCP client. Requires Node 24 or newer.
const [major] = process.versions.node.split(".").map(Number);
if (major < 24) {
  console.error(`SundhedMCP needs Node 24 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}
await import("../dist/lib/stdio.js");
