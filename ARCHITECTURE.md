# Architecture

SundhedMCP is a pnpm workspace with three packages. Each layer only imports
the one below it.

```
packages/mcp-server      sundhedmcp (published to npm)
        │                MCP tools, stdio and HTTP entry points, the phone
        │                guide, OAuth, Tailscale, the saved copy of the record
        ▼
packages/sundhed-client  @sundhedmcp/client
        │                sundhed.dk's citizen endpoints (medicine card, lab
        │                results, vaccinations, ...) and the cleaning that
        │                masks CPR numbers in every response
        ▼
packages/sundhed-session @sundhedmcp/session
                         one real browser (Playwright), the MitID login in
                         its window, and apiGet(): fetch() run inside it
```

## Packages

**`@sundhedmcp/session`** owns the browser. sundhed.dk has no refresh token
and no public API, so the session is the logged-in browser itself: every call
runs as a `fetch()` in its page, with the site's own cookies and headers.
Nothing is written to disk here. A `SundhedSession` is one browser; the
module functions (`connect`, `apiGet`, ...) act on the current one, set with
`withSession` (AsyncLocalStorage), so the client and the tools never pass a
session around. One person uses `defaultSession`.

**`@sundhedmcp/client`** maps the Min Side apps to functions, one per
endpoint, and returns cleaned data. `data.ts` has the cleaning (CPR masking,
HTML entities, dates) and is the part with unit tests. All calls are GET:
SundhedMCP only reads.

**`sundhedmcp`** (`packages/mcp-server`) is everything a person runs:

| Entry point | What it is |
|---|---|
| `src/stdio.ts` | `sundhedmcp`: local MCP server over stdio |
| `src/serve.ts` | `sundhedmcp serve`: this computer as the server for claude.ai and the phone |
| `src/server.ts` | The Docker image: an info page, or hosted mode with `SUNDHEDMCP_HOSTED=1` |

In hosted mode `auth.ts` is the OAuth server for one user, the admin
password; `/mcp` takes its bearer tokens. Tokens from `SUNDHEDMCP_API_TOKENS`
are accepted too, for clients such as kagent that cannot sign in; they are
compared by sha256, like the stored OAuth tokens. `charts/sundhedmcp` deploys
hosted mode to Kubernetes and wires such a token into a kagent
`RemoteMCPServer`.

With `SUNDHEDMCP_MULTI_USER=1` there is no OAuth server or password.
`oidc.ts` checks each `/mcp` token against the identity provider's keys
(`iss`, `aud`, `exp`, asymmetric algorithms only) and takes the person from
`sub`; `/connect` signs the browser in with the same provider (code flow with
PKCE). `users.ts` gives each person, by `callerId` (sha256 of issuer and
sub), their own `SundhedSession` and `SavedCopy`, and the request runs inside
`asOwner`, so a tool only ever reaches its caller's session and copy.

`api.ts` serves `/api/v1` from the saved copy, behind the same bearer check
as `/mcp`, inside `asOwner` too. Its changing calls (refresh, logout, delete
the copy) act on the server only; with several people they need the write
scope. `/connect/record` (`recordPage` in `pages.ts`) renders the copy
for the browser without knowing its shapes: lists of objects as tables,
objects as label and value, deeper data as escaped JSON.

## Storage

`storage.ts` keeps the saved copy of the record in SQLite (`node:sqlite`) or
PostgreSQL (`pg`), one row per part (`summary`, `medication_card`, ...) and
one per detail (`medication_detail/<id>`, ...), under an owner id: `default` for one
person, the `callerId` for each of several. The OAuth state (clients, codes,
token hashes) is one row under the owner `server` (`store.ts`). `storage-crypto.ts` seals every row with
AES-256-GCM under a key derived per owner (HKDF), with owner, kind and id as
associated data, so a row moved to another owner or id does not open.
Rotation: the current key seals, previous keys still open, and `reencrypt()`
seals the old rows again.

`snapshot.ts` holds the copy (a `SavedCopy`, one per person) in memory for the tools and writes it through to
storage. It fetches by part (`summary`, `medicationCard` with its details,
...), one fetch at a time. A part that fails keeps the previous copy of it,
and its error says from when; each part records when it was fetched, which
the tools give as the copy's age.

`sync.ts` fetches the whole copy after each login (`onLogin`), then each part
again on its own interval while the session lasts, with jitter and backoff.
When a fetch finds the session gone it waits for the next login. The schedule
is in memory only: after a restart there is no session until the next login.

## Running and building

In the workspace everything runs from source with Node's type stripping, and
the workspace packages resolve through their `exports` (`./src/index.ts`):

```bash
pnpm start                                   # stdio
pnpm serve                                   # serve
node packages/mcp-server/src/server.ts       # Docker entry point
```

`@sundhedmcp/session` and `@sundhedmcp/client` are private and not on npm.
`pnpm build` (`packages/mcp-server/build.ts`) bundles them into
`packages/mcp-server/dist/lib` with esbuild and keeps the npm dependencies
external, so the published package installs exactly like before. Chunks sit
next to the entry points, which keeps `./assets/` and `./serve.js` resolving
from `import.meta.url`.

The Docker image builds the same bundle and copies in what `pnpm deploy`
gives for `sundhedmcp`: `bin`, `dist/lib` and the production dependencies.

## Versioning

All packages share one version. release-please bumps the root
`package.json` and, through `extra-files`, each package's `package.json` and
`VERSION` in `packages/mcp-server/src/mcp.ts`.
