# Contributing

```bash
npm install -g pnpm   # or corepack enable on Node 24
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

The code is split into three packages; [ARCHITECTURE.md](ARCHITECTURE.md)
has the layers and how the published package is built.

- **No real health data, ever.** Tests and fixtures use made-up records only.
  Captured responses go in `fixtures/private/`, which git ignores.
- **Read-only.** SundhedMCP only sends GET requests to sundhed.dk's citizen
  pages. A change that writes to sundhed.dk will not be merged.
- **Telemetry carries no record data.** Span names and metric labels are
  route templates, tool, part and app names, status codes and outcomes,
  never an id, a value from the record or who is signed in. Log lines go
  through `scrubLog`, but do not rely on it: do not log record data at all.
- **The chart** is linted in CI (`helm lint`, `ct lint`). Add a values file
  to `charts/sundhedmcp/ci/` for a new mode, and run `scripts/kind-test.sh`
  before a chart change that touches the pod.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:` …). release-please turns them into the
  changelog and the next version.
- **Dependencies** are updated by Renovate. pnpm refuses packages younger than
  two days (`minimumReleaseAge`), so a fresh release may need a short wait.
