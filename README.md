# SundhedMCP

**Your AI now reads your health record.** A small, local, read-only MCP server
that lets Claude (or any MCP client) read your own record on
[sundhed.dk](https://www.sundhed.dk): medicine card, prescriptions, lab
results, vaccinations and referrals.

Not affiliated with sundhed.dk, Sundhedsdatastyrelsen or MitID. For one person
reading their own record on their own machine. It runs locally; there is no
hosted service. If you run it on a server yourself, read
[SELF-HOSTING.md](SELF-HOSTING.md) first.

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
  data under GDPR; running it for someone else makes you responsible for it
  (see [SELF-HOSTING.md](SELF-HOSTING.md) if you do it anyway).
- **It retrieves; it does not interpret.** The tools return what sundhed.dk
  shows, with no flags, scores or advice. It is not a medical device and not
  medical advice. Ask your GP or pharmacist before changing any medicine.
- **Unofficial.** sundhed.dk has no citizen API. SundhedMCP reads the same
  pages your browser does, after your own login. Check sundhed.dk's terms of
  use yourself.
- **No telemetry.** No analytics, no crash reporting, no logging of your data.
  A server you host yourself can send its own traces and metrics to your own
  collector; they never carry record data.

## How it works

```
Your AI ──stdio──▶ SundhedMCP ──fetch() inside a real browser──▶ sundhed.dk
                        │
                        └─ you log in with MitID in that browser's window
```

sundhed.dk has no public API for citizens. SundhedMCP opens a browser window
on sundhed.dk, you log in with MitID, and every tool then calls the same JSON
endpoints the site's own pages use, from inside that logged-in browser.

- **Local.** No SundhedMCP service in between, no telemetry.
- **In memory.** The session lives in the browser this process owns. Right
  after each login the whole record is fetched into memory, so the tools still
  answer after sundhed.dk ends the session. Stop the server and it is gone.
  Nothing is written to disk. (Phone mode is different: see below.)
- **Read-only.** Only GET requests to the citizen pages.
- **CPR masked.** CPR numbers are replaced with `[CPR]` in every result.

## Setup

Needs Node 24+ (26 recommended) and Google Chrome, Microsoft Edge or Chrome Canary (or run
`pnpm exec playwright-core install chromium`).

```bash
npm install -g pnpm   # or corepack enable on Node 24
pnpm install
claude mcp add sundhedmcp -- node /path/to/sundhedmcp/packages/mcp-server/src/stdio.ts
```

Then ask your assistant to "connect sundhed.dk", click **Log på** in the
window that opens and approve in the MitID app. The window minimizes itself;
leave it running.

### Use it from your phone (claude.ai)

Your own computer becomes the server. Nothing runs on a server of ours.
Step-by-step with pictures: [sundhedmcp.dk/opsaetning](https://sundhedmcp.dk/opsaetning.html) ([English](https://sundhedmcp.dk/setup.html)).

1. Run `npx -y sundhedmcp serve`, or ask your assistant to "set up SundhedMCP
   for my phone" (the `phone_access` tool).
2. Follow the guide that opens at `http://localhost:8787/guide`:
   choose a password, install [Tailscale](https://tailscale.com/download) and
   click **Open to claude.ai**, click **Start at login**, add the connector
   in claude.ai with the address the guide shows, and log in with MitID.
3. Open Claude on your phone and ask about your medicine card.

It works while the computer is on and awake. Tailscale Funnel gives the
computer a fixed public HTTPS address; the connector behind it needs your
password (OAuth), and the guide itself only answers on this computer. After
the MitID login, a copy of your record is kept in `~/.sundhedmcp`, encrypted
(AES-256-GCM, with a key in `~/.sundhedmcp/storage.key`), so your phone can
read it after the sundhed.dk session ends. `disconnect_sundhed` with
`forget_saved_copy` deletes it.

That copy is your whole record (medicine, prescriptions, lab results,
vaccinations, referrals). The key sits next to it, readable only by your user
(mode 600), so keep disk encryption on (FileVault, BitLocker, LUKS).

The Docker image (`packages/mcp-server/src/server.ts`) serves only a page that
points here. With `SUNDHEDMCP_HOSTED=1` it runs hosted mode instead, on a server
of your own, for one person or several, with an API, telemetry and a Helm
chart: see [SELF-HOSTING.md](SELF-HOSTING.md).

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
| `phone_access` | Starts `sundhedmcp serve` and opens its setup guide for claude.ai and your phone |

## Settings

| Variable | Default | |
|---|---|---|
| `SUNDHEDMCP_BROWSER` | tries chrome, msedge, chrome-beta, chrome-canary, chromium | Playwright channel to use |
| `SUNDHEDMCP_TAILSCALE` | found in the usual places | Path to the tailscale CLI, for `serve` |
| `SUNDHEDMCP_KEEPALIVE_MS` | `240000` | How often to touch the session; `0` turns it off |
| `SUNDHEDMCP_SYNC` | on | `0` fetches the saved copy after each login only |

Hosted mode has more (password, several people with OIDC, the API, telemetry,
the Helm chart): see [SELF-HOSTING.md](SELF-HOSTING.md).

### Sync

Right after each MitID login the whole record is fetched into the saved copy.
While the session lasts, each part is fetched again on its own interval, so
the copy is close to current when sundhed.dk ends the session: the summary,
medicine card and prescriptions every hour, lab results every 6 hours,
vaccinations and referrals every day. One part runs at a time, and only reads.
A part that fails keeps its previous copy and is tried again after 10 minutes,
then less often. `session_status` shows when each part was fetched and when it
is fetched next.

### Storage of the saved copy

`serve` and hosted mode keep the copy in an encrypted database so it survives a
restart; local stdio mode keeps it in memory only unless `SUNDHEDMCP_STORAGE`
is set. Every row is sealed with AES-256-GCM, so the database and its backups
hold only ciphertext. Losing the key makes the copy unreadable, which is safe:
it is fetched again at the next login.

| Variable | Default | |
|---|---|---|
| `SUNDHEDMCP_STORAGE` | `sqlite` (`serve`, hosted), `none` (stdio) | `sqlite`, `postgres`, or `none` for memory only |
| `SUNDHEDMCP_SQLITE_PATH` | `<DATA_DIR>/sundhed.db` | SQLite file |
| `SUNDHEDMCP_DATABASE_URL` | | PostgreSQL URL; required for `postgres` |
| `SUNDHEDMCP_STORAGE_KEY` | generated into `<DATA_DIR>/storage.key` | 32 random bytes, base64 (`openssl rand -base64 32`) |
| `SUNDHEDMCP_STORAGE_PREVIOUS_KEYS` | | Earlier keys, comma-separated, that still open the rows they sealed |

`DATA_DIR` is `~/.sundhedmcp` for `serve` and `./data` (`/data` in the image)
otherwise. A `snapshot.json` or `oauth.json` from an earlier version is moved
into the database on start and then deleted.

## Development

```bash
pnpm test         # unit tests (synthetic data only)
pnpm typecheck
pnpm lint         # biome
pnpm build        # bundles packages/mcp-server for npm
```

The code is a pnpm workspace of three packages; see [ARCHITECTURE.md](ARCHITECTURE.md).
CI runs all four, plus a lint of the chart, on every pull request. Images
are built on your own machine for now (`scripts/push-image.sh`, and
`scripts/kind-test.sh` for the chart tests), not in GitHub Actions. Commit
messages follow [Conventional Commits](https://www.conventionalcommits.org/):
release-please reads them to write the changelog and bump the version.

The landing page is built from `site/`: edit `site/en.source.html` (English),
then `python3 site/translate.py` writes the Danish page (it lists any
translation pair that no longer matches) and `python3 site/build.py` writes
`docs/` for GitHub Pages.

Never commit captured responses: they are real health data. `fixtures/private/`
is ignored for that reason.

## License

MIT. The landing page uses transitions from [transitions.dev](https://transitions.dev) by Jakub Antalík.
