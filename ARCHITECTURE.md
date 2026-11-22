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
Nothing is written to disk here.

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
