# SundhedMCP

**Your AI now reads your health record.** A small, local, read-only MCP server
that lets Claude (or any MCP client) read your own record on
[sundhed.dk](https://www.sundhed.dk): medicine card, prescriptions, lab
results, vaccinations and referrals.

Not affiliated with sundhed.dk, Sundhedsdatastyrelsen or MitID. For one person
reading their own record on their own machine. It runs locally only; there is
no hosted version.

## Before you use it

- **Your AI provider sees what it reads.** SundhedMCP runs on your computer and
  talks only to sundhed.dk. But everything your AI reads through it (medicine,
  prescriptions, lab results, vaccinations, referrals) is sent to the AI
  provider you connect it to, such as Anthropic or OpenAI, and handled under
  that provider's terms and retention rules. That is your choice; make it
  knowingly.
- **You approve every login.** You type your MitID user ID on the real MitID
  page in a browser window on your own computer and approve in your own MitID
  app. SundhedMCP never sees, stores or passes on MitID credentials.
- **Your own record only.** Do not run it for family members, patients or
  anyone else, and do not host it for others. Health data is special-category
  data under GDPR; running it for someone else makes you responsible for it.
- **It retrieves; it does not interpret.** The tools return what sundhed.dk
  shows, with no flags, scores or advice. It is not a medical device and not
  medical advice. Ask your GP or pharmacist before changing any medicine.
- **Unofficial.** sundhed.dk has no citizen API. SundhedMCP reads the same
  pages your browser does, after your own login. Check sundhed.dk's terms of
  use yourself.
- **No telemetry.** No analytics, no crash reporting, no logging of your data.

## How it works

```
Your AI ──stdio──▶ SundhedMCP ──fetch() inside a real browser──▶ sundhed.dk
                        │
                        └─ you log in with MitID in that browser's window
```

sundhed.dk has no public API for citizens. SundhedMCP opens a browser window
on sundhed.dk, you log in with MitID, and every tool then calls the same JSON
endpoints the site's own pages use, from inside that logged-in browser.

- **Local only.** No SundhedMCP service in between, no telemetry.
- **In memory.** The session lives in the browser this process owns. Right
  after each login the whole record is fetched into memory, so the tools still
  answer after sundhed.dk ends the session. Stop the server and it is gone.
  Nothing is written to disk.
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

### Hosted mode is off

Earlier versions could run on Railway or Docker for claude.ai. That is switched
off: `src/server.ts` now serves only a page that points here, with no MCP
endpoint, no OAuth, no browser and no MitID login. The hosted code is still in
`src/` (app.ts, auth.ts, pages.ts, store.ts) but is not started.

## Tools

| Tool | What it returns |
|---|---|
| `connect_sundhed` | Opens the login window on your computer and waits up to 3 minutes for MitID |
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

The landing page is built from `site/`: edit `site/en.source.html` (English),
then `python3 site/translate.py` writes the Danish page (it lists any
translation pair that no longer matches) and `python3 site/build.py` writes
`docs/` for GitHub Pages.

Never commit captured responses: they are real health data. `fixtures/private/`
is ignored for that reason.

## License

MIT. The landing page uses transitions from [transitions.dev](https://transitions.dev) by Jakub Antalík.
