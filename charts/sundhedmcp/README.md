# sundhedmcp chart

Runs SundhedMCP's hosted mode in one pod: the server, Chromium for the
sundhed.dk session, and a PVC for the password hash and the encrypted SQLite
database. Optional: several people signed in with OIDC (`mode: multi-user`),
Postgres, an HTTPRoute, a NetworkPolicy, a kagent `RemoteMCPServer` and
`Agent`, OpenTelemetry and a Perses dashboard.

```bash
helm upgrade --install sundhedmcp charts/sundhedmcp -n sundhedmcp --create-namespace \
  --set image.repository=<registry>/<project>/sundhedmcp --set image.tag=dev-<sha>
```

Every setting is described in [`values.yaml`](values.yaml); a setting left
half done fails the render with what is missing. [`ci/`](ci) has a values
file for each mode, and [`examples/`](examples) the Keycloak clients for
multi-user mode. How the modes work, and what you take on by hosting health
data: [SELF-HOSTING.md](../../SELF-HOSTING.md).
