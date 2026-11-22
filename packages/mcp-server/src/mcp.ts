import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { instrumentTools } from "./telemetry.ts";
import { config } from "./config.ts";
import { registerTools } from "./tools.ts";

export const VERSION = "0.2.0"; // x-release-please-version

export interface ServerOptions {
  /** The caller may change things: with several people, their token has the write scope. */
  canWrite?: boolean;
}

export function createServer(options: ServerOptions = {}): McpServer {
  const canWrite = options.canWrite ?? true;
  const server = new McpServer(
    { name: "sundhed", version: VERSION },
    {
      instructions: [
        config.allowRenewal
          ? "Access to the owner's own health record on sundhed.dk (Denmark): medicine card, prescriptions, lab results, vaccinations and referrals. It only reads, except renew_prescription, which asks the owner's GP to renew a prescription; use it only when the owner asks, and only after they confirm the exact medicine, package and quantity."
          : "Read-only access to the owner's own health record on sundhed.dk (Denmark): medicine card, prescriptions, lab results, vaccinations and referrals.",
        "The owner logs in with MitID through connect_sundhed. If a tool says they are not logged in, call connect_sundhed and relay what it says.",
        "Field names and many values are Danish, as sundhed.dk returns them. Translate for the owner when they write in another language.",
        "CPR numbers are masked as [CPR]. Never ask the owner for theirs.",
        "SundhedMCP only retrieves and shows the record; it does not interpret results. This is the owner's own data, not medical advice. For questions about changing or stopping medicine, point them to their GP or pharmacist.",
      ].join(" "),
    },
  );
  registerTools(instrumentTools(server), { canWrite });
  return server;
}
