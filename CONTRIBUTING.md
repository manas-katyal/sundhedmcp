# Contributing

```bash
corepack enable
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

- **No real health data, ever.** Tests and fixtures use made-up records only.
  Captured responses go in `fixtures/private/`, which git ignores.
- **Read-only.** SundhedMCP only sends GET requests to sundhed.dk's citizen
  pages. A change that writes to sundhed.dk will not be merged.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:` …). release-please turns them into the
  changelog and the next version.
- **Dependencies** are updated by Renovate. pnpm refuses packages younger than
  two days (`minimumReleaseAge`), so a fresh release may need a short wait.
