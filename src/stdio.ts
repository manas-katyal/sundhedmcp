// Entry point for Claude Code, Claude Desktop, Cursor and other stdio MCP
// clients. Nothing may write to stdout except the transport.
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { createServer } = await import("./mcp.ts");
const { disconnect } = await import("./session.ts");

// Exit with the client, and take the browser (and the session in it) down too.
let exiting = false;
async function exit(): Promise<never> {
  if (!exiting) {
    exiting = true;
    await Promise.race([disconnect(), new Promise((r) => setTimeout(r, 3_000))]);
  }
  process.exit(0);
}

const transport = new StdioServerTransport();
transport.onclose = () => void exit();
process.stdin.on("end", () => void exit());
process.on("SIGINT", () => void exit());
process.on("SIGTERM", () => void exit());
await createServer().connect(transport);
