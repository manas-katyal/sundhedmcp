import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.ts";

export const VERSION = "0.1.0";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "sundhed", version: VERSION },
    {
      instructions: [
        "Read-only access to the owner's own health record on sundhed.dk (Denmark): medicine card, prescriptions, lab results, vaccinations and referrals.",
        "The owner logs in with MitID through connect_sundhed. If a tool says they are not logged in, call connect_sundhed and relay what it says.",
        "Field names and many values are Danish, as sundhed.dk returns them. Translate for the owner when they write in another language.",
        "CPR numbers are masked as [CPR]. Never ask the owner for theirs.",
        "This is the owner's own data, not medical advice. For questions about changing or stopping medicine, point them to their GP or pharmacist.",
      ].join(" "),
    },
  );
  registerTools(server);
  return server;
}
