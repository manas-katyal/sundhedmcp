# SundhedMCP

**Your AI now reads your health record.** A small, local, read-only MCP server
that lets Claude (or any MCP client) read your own record on
[sundhed.dk](https://www.sundhed.dk): medicine card, prescriptions, lab
results, vaccinations and referrals.

Not affiliated with sundhed.dk, Sundhedsdatastyrelsen or MitID. For one person
reading their own record on their own machine.

## How it works

```
Your AI ──stdio──▶ SundhedMCP ──fetch() inside a real browser──▶ sundhed.dk
                        │
                        └─ you log in with MitID in that browser's window
```

sundhed.dk has no public API for citizens. SundhedMCP opens a browser window
on sundhed.dk, you log in with MitID, and every tool then calls the same JSON
endpoints the site's own pages use, from inside that logged-in browser.

- **Local only.** No server, no account, no telemetry.
- **In memory.** The session lives in the browser this process owns. Stop the
  server or close the window and it is gone. Nothing is written to disk.
- **Read-only.** Only GET requests to the citizen pages.
- **CPR masked.** CPR numbers are replaced with `[CPR]` in every result.

## Setup

Needs Node 24+ and Google Chrome, Microsoft Edge or Chrome Canary (or run
`npx playwright-core install chromium`).

```bash
npm install
claude mcp add sundhedmcp -- node /path/to/sundhedmcp/src/stdio.ts
```

Then ask your assistant to "connect sundhed.dk", click **Log på** in the
window that opens and approve in the MitID app. The window minimizes itself;
leave it running.

## Tools

| Tool | What it returns |
|---|---|
| `connect_sundhed` | Opens the login window and waits up to 3 minutes for MitID |
| `session_status` | Whether the session is live, and how long the last one lasted |
| `disconnect_sundhed` | Closes the browser and forgets the session |
| `get_summary` | Counts: medicine, prescriptions, vaccinations |
| `get_medication_card` | Current medicine on Fælles Medicinkort |
| `get_medication_details` | One medicine: ATC code, prescriber, substitution, reimbursement |
| `get_prescriptions` | Open prescriptions with validity and remaining units |
| `get_prescription` | One prescription: dispensings left, pharmacy, package |
| `get_lab_results` | Regional lab results for a date range (default 12 months) |
| `get_vaccinations` | Every registered vaccination |
| `get_vaccination` | One vaccination: diseases covered, programme, coverage |
| `get_referrals` | Active and earlier referrals |

## Settings

| Variable | Default | |
|---|---|---|
| `SUNDHEDMCP_BROWSER` | tries chrome, msedge, chrome-beta, chrome-canary, chromium | Playwright channel to use |
| `SUNDHEDMCP_KEEPALIVE_MS` | `240000` | How often to touch the session; `0` turns it off |

## Development

```bash
npm test          # unit tests (synthetic data only)
npm run typecheck
```

Never commit captured responses: they are real health data. `fixtures/private/`
is ignored for that reason.

## License

MIT. The landing page uses transitions from [transitions.dev](https://transitions.dev) by Jakub Antalík.
