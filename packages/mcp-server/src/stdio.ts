// Entry point for Claude Code, Claude Desktop, Cursor and other stdio MCP
// clients. Nothing may write to stdout except the transport.
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { createServer } = await import("./mcp.ts");
const { disconnect, onLogin } = await import("@sundhedmcp/session");
const { refresh, useStorage } = await import("./snapshot.ts");
const { openStorage, SINGLE_OWNER_ID } = await import("./storage.ts");
const { homedir } = await import("node:os");
const { join } = await import("node:path");

// After each MitID login, fetch the whole record into memory, for when the
// session ends. Kept only in memory unless SUNDHEDMCP_STORAGE asks for storage.
const storage = await openStorage(process.env.DATA_DIR?.trim() || join(homedir(), ".sundhedmcp"), "none");
if (storage) await useStorage(storage.forOwner(SINGLE_OWNER_ID));
onLogin(() => void refresh().catch((err) => console.error(`[snapshot] failed: ${(err as Error).message}`)));

// Exit with the client, and take the browser (and the session in it) down too.
let exiting = false;
async function exit(): Promise<never> {
  if (!exiting) {
    exiting = true;
    await Promise.race([Promise.all([disconnect(), storage?.close()]), new Promise((r) => setTimeout(r, 3_000))]);
  }
  process.exit(0);
}

const transport = new StdioServerTransport();
transport.onclose = () => void exit();
process.stdin.on("end", () => void exit());
process.on("SIGINT", () => void exit());
process.on("SIGTERM", () => void exit());
await createServer().connect(transport);
