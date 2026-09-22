import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { connect, disconnect, hostedLoginUrl, SessionGone, startLogin, status } from "./session.ts";
import * as sundhed from "./sundhed.ts";
import { monthsAgo } from "./data.ts";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value ?? [], null, 2) }] });
const text = (message: string) => ({ content: [{ type: "text" as const, text: message }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

type Result = ReturnType<typeof json> | ReturnType<typeof fail>;

function guard<A extends unknown[]>(fn: (...args: A) => Promise<Result>) {
  return async (...args: A): Promise<Result> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof SessionGone) return fail(err.message);
      return fail(`Error: ${(err as Error).message}`);
    }
  };
}

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export function registerTools(server: McpServer): void {
  // --- Session ---

  server.registerTool(
    "connect_sundhed",
    {
      title: "Connect sundhed.dk",
      description:
        "Starts a sundhed.dk login with MitID. Locally it opens a browser window and waits up to 3 minutes; tell the person to click 'Log på' there and approve in the MitID app. On a hosted server it returns a link the person opens to log in; relay the link and ask them to say when they are done. Call this when another tool says the person is not logged in.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const loginUrl = hostedLoginUrl();
      if (loginUrl) {
        if (await startLogin()) return text("Logged in to sundhed.dk.");
        return text(
          `Not logged in yet. Ask the person to open ${loginUrl}, enter the server password, click 'Log på' in the page and approve in the MitID app. When they say they are done, call the tool they asked for.`,
        );
      }
      const result = await connect();
      if (result.connected) return text("Logged in to sundhed.dk. The browser window is minimized; leave it running.");
      return fail(result.reason);
    }),
  );

  server.registerTool(
    "session_status",
    {
      title: "Session status",
      description: "Whether the sundhed.dk session is live, for how long, and how long the previous one lasted before sundhed.dk ended it.",
      annotations: readOnly,
    },
    guard(async () => json(await status())),
  );

  server.registerTool(
    "disconnect_sundhed",
    {
      title: "Log out of sundhed.dk",
      description: "Closes the browser and forgets the session. Nothing is stored, so the next use needs a new MitID login.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guard(async () => {
      await disconnect();
      return text("Logged out. The browser is closed and the session is gone.");
    }),
  );

  // --- Health record ---

  server.registerTool(
    "get_summary",
    {
      title: "Health record summary",
      description:
        "Counts across the record: active, paused and stopped medicine; open, closed and future prescriptions; given, planned and overdue vaccinations. A cheap first call.",
      annotations: readOnly,
    },
    guard(async () => json(await sundhed.summary())),
  );

  server.registerTool(
    "get_medication_card",
    {
      title: "Medicine card",
      description:
        "Current medicine on Fælles Medicinkort, newest first: drug, form, strength, dosage text, reason (Cause), active substance, start date and status. Use OrdinationId with get_medication_details.",
      annotations: readOnly,
    },
    guard(async () => json(await sundhed.medicationCard())),
  );

  server.registerTool(
    "get_medication_details",
    {
      title: "Medicine details",
      description:
        "One medicine on the card in full: ATC code, administration, substitution and reimbursement, dosage period, and who created, changed or stopped it.",
      inputSchema: { ordination_id: z.string().describe("OrdinationId from get_medication_card") },
      annotations: readOnly,
    },
    guard(async ({ ordination_id }) => json(await sundhed.medicationDetails(ordination_id))),
  );

  server.registerTool(
    "get_prescriptions",
    {
      title: "Open prescriptions",
      description:
        "Open prescriptions (recepter): drug, strength, dosage, valid from and to, remaining units and status. Use PrescriptionId with get_prescription for dispensings left and the pharmacy.",
      annotations: readOnly,
    },
    guard(async () => json(await sundhed.openPrescriptions())),
  );

  server.registerTool(
    "get_prescription",
    {
      title: "Prescription details",
      description:
        "One prescription in full: dispensings given and remaining, remaining units, validity, issuing doctor and clinic, receiving pharmacy, package size, reimbursement and substitution.",
      inputSchema: { prescription_id: z.string().describe("PrescriptionId from get_prescriptions") },
      annotations: readOnly,
    },
    guard(async ({ prescription_id }) => json(await sundhed.prescription(prescription_id))),
  );

  server.registerTool(
    "get_lab_results",
    {
      title: "Test results",
      description:
        "Regional lab results (prøvesvar) for a date range, default the last 12 months: requisitions, analyses, values and reference intervals. An empty result means no regional results in that range, not that none exist anywhere; try a wider range.",
      inputSchema: {
        from: dateString.optional().describe("First day, YYYY-MM-DD. Default 12 months ago."),
        to: dateString.optional().describe("Last day, YYYY-MM-DD. Default today."),
      },
      annotations: readOnly,
    },
    guard(async ({ from, to }) => {
      const end = to ? new Date(`${to}T12:00:00`) : new Date();
      const start = from ? new Date(`${from}T12:00:00`) : monthsAgo(12, end);
      if (start > end) return fail("`from` is after `to`.");
      return json(await sundhed.labResults(start, end));
    }),
  );

  server.registerTool(
    "get_vaccinations",
    {
      title: "Vaccinations",
      description:
        "Every registered vaccination, newest first: vaccine, date, who gave it and how long it covers. Use VaccinationIdentifier with get_vaccination for the diseases it protects against.",
      annotations: readOnly,
    },
    guard(async () => json(await sundhed.vaccinations())),
  );

  server.registerTool(
    "get_vaccination",
    {
      title: "Vaccination details",
      description:
        "One vaccination in full: diseases covered, vaccination programme, coverage, organisation, and whether a pharmacy or health record confirmed it.",
      inputSchema: { vaccination_id: z.string().describe("VaccinationIdentifier from get_vaccinations") },
      annotations: readOnly,
    },
    guard(async ({ vaccination_id }) => json(await sundhed.vaccination(vaccination_id))),
  );

  server.registerTool(
    "get_referrals",
    {
      title: "Referrals",
      description: "Active and earlier referrals (henvisninger) to specialists and hospitals.",
      annotations: readOnly,
    },
    guard(async () => json(await sundhed.referrals())),
  );
}
