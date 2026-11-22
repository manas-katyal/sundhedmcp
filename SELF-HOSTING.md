# Self-hosting SundhedMCP

SundhedMCP is made to run on your own computer (see the [README](README.md)).
Hosted mode runs the same server somewhere else, with its own browser, so
claude.ai, a phone or an assistant such as kagent can reach it without your
computer being on. Read this before you do.

- **You are hosting health data.** The server keeps an encrypted copy of the
  record of everyone who logs in. With several people, you hold other
  people's special-category data under GDPR: only run it for people who asked
  for it and know where it lives.
- **The MitID login still happens in the server's browser.** `/connect`
  shows that browser's page to the person signed in, and they approve in
  their own MitID app. Nobody else can log in for them, but whoever runs the
  server can reach the session while it lasts.
- **Read-only still holds.** Hosted mode only sends GET requests to
  sundhed.dk. The API calls that change something act on this server only.

## One person

`SUNDHEDMCP_HOSTED=1` (set in the Docker image's entry point,
`packages/mcp-server/src/server.ts`) turns hosted mode on. `/mcp` and
`/api/v1` then need an OAuth token for the admin password, or one of
`SUNDHEDMCP_API_TOKENS`; `/connect` asks for the password before the MitID
login.

```bash
podman run -p 8080:8080 -v sundhedmcp:/data -e SUNDHEDMCP_HOSTED=1 \
  -e BASE_URL=https://sundhed.example.com -e ADMIN_PASSWORD=<12+ characters> <image>
```

Then log in with MitID at `<BASE_URL>/connect` and add `<BASE_URL>/mcp` as a
connector in claude.ai. Without `ADMIN_PASSWORD` the first visitor to
`BASE_URL` chooses the password, so do that before the address is public (the
chart always sets one).

| Variable | Default | |
|---|---|---|
| `SUNDHEDMCP_HOSTED` | | `1` for hosted mode; otherwise the image only serves a page pointing at the local setup |
| `BASE_URL` | `http://localhost:<PORT>` (or the platform's URL on Railway, Fly, Render) | The public URL; OAuth and the MitID page use it |
| `PORT` | `8080` | |
| `DATA_DIR` | `./data` (`/data` in the image) | Password hash, storage key, SQLite database |
| `ADMIN_PASSWORD` | | 12+ characters; stored as a hash on first start. Without it, choose one at `BASE_URL` |
| `ALLOWED_REDIRECT_HOSTS` | `claude.ai,claude.com,chatgpt.com,cursor.com,vscode.dev,localhost,127.0.0.1` | Hosts OAuth clients may redirect to |
| `SUNDHEDMCP_API_TOKENS` | | Hosted: bearer tokens `/mcp` accepts besides OAuth, comma-separated, 32+ characters each, for clients that cannot sign in with the password (kagent) |
| `SUNDHEDMCP_MULTI_USER` | | Hosted: `1` for several people, each signed in with an identity provider ([below](#several-people-oidc)) |

The [storage](README.md#storage-of-the-saved-copy) and
[sync](README.md#sync) settings in the README apply here too; hosted mode
keeps the copy in SQLite under `DATA_DIR` by default.

## Several people (OIDC)

Hosted mode serves one person by default. With `SUNDHEDMCP_MULTI_USER=1`
everyone signs in with the same OpenID Connect provider (Keycloak, say), and
each person gets their own sundhed.dk session and their own saved copy,
encrypted under a key derived for them. There is no admin password and no
API token then: `/mcp` needs an access token from the provider, and
`/connect` signs the browser in with it before the MitID login. Only run it
for people who asked for it; their health data is then on your server.

| Variable | |
|---|---|
| `SUNDHEDMCP_OIDC_ISSUER` | Must equal the tokens' `iss` exactly; https |
| `SUNDHEDMCP_OIDC_AUDIENCE` | Must be in the access tokens' `aud` |
| `SUNDHEDMCP_OIDC_ACCEPT_ID_TOKEN` | `1` also accepts ID tokens (kagent's oauth2-proxy forwards those); `aud` still applies |
| `SUNDHEDMCP_OIDC_CLIENT_ID` | The client `/connect` signs in with; redirect URI `<BASE_URL>/connect/callback` |
| `SUNDHEDMCP_OIDC_CLIENT_SECRET` | Its secret, unless it is a public client |
| `SUNDHEDMCP_ANONYMOUS_TOOL_LIST` | `1` answers `initialize` and `tools/list` without a token, for kagent's tool discovery; tool calls still need one |
| `SUNDHEDMCP_API_WRITE_SCOPE` | The scope (default `sundhed:write`) a token needs for the `/api/v1` calls that change something; empty lets any valid token |

A setting left half done stops the server at start. MCP clients find the
provider through `/.well-known/oauth-protected-resource`. With the chart, set
`mode: multi-user` and `oidc.*`; with kagent the `RemoteMCPServer` then
forwards the signed-in user's token (`tokenPassthrough`) instead of an API
token. kagent needs its own sign-in through the same realm for that (see
[kagent with Keycloak](#kagent-with-keycloak) below).

In Keycloak, import
[`examples/keycloak-connect-client.json`](./charts/sundhedmcp/examples/keycloak-connect-client.json)
as the `/connect` client (set your host, copy its secret into
`oidc.clientSecret.existingSecret`), and add
[`examples/keycloak-kagent-audience-mapper.json`](./charts/sundhedmcp/examples/keycloak-kagent-audience-mapper.json)
to the client kagent signs in with, so the tokens it forwards carry
`aud: sundhedmcp`:

```sh
kcadm.sh create clients -r <realm> -f keycloak-connect-client.json
kcadm.sh create clients/<kagent client uuid>/protocol-mappers/models -r <realm> -f keycloak-kagent-audience-mapper.json
```

## kagent with Keycloak

kagent forwards the signed-in user's token only when kagent itself sits
behind a sign-in through the same Keycloak realm, typically oauth2-proxy in
front of the kagent UI with `--pass-authorization-header`. That changes how
everyone logs in to kagent, so set it up first and check that the token it
forwards carries `aud: sundhedmcp` (the audience mapper above) before you
switch the chart to `mode: multi-user`. Set `oidc.acceptIdToken` when the
proxy forwards ID tokens rather than access tokens.

kagent lists tools without a user (`kagent.remoteMCPServer.discovery`, which
sets `SUNDHEDMCP_ANONYMOUS_TOOL_LIST`); each tool call then carries the
person's token and reaches only their copy. A person who has not logged in
with MitID is sent, through `connect_sundhed`, to `<BASE_URL>/connect`.

## API and the saved copy in the browser

Hosted mode also answers JSON at `/api/v1`, from the saved copy, with the same
bearer tokens as `/mcp` (with one person: the OAuth tokens and
`SUNDHEDMCP_API_TOKENS`; with several: the provider's access tokens, each
reaching only its own person's copy). `/api/v1/openapi.json` describes it.

| Call | |
|---|---|
| `GET /status` | Logged in, refreshing, sync, when each part was fetched, errors |
| `GET /summary`, `/lab-results`, `/referrals` | One part: `{ fetchedAt, error, data }` |
| `GET /medication-card`, `/prescriptions`, `/vaccinations` | The list, plus `details`: the ids with details |
| `GET /medication-card/{id}`, `/prescriptions/{id}`, `/vaccinations/{id}` | One detail |
| `POST /refresh` | Fetch everything (or `{"parts": [...]}`) again in the background; `202` |
| `POST /logout` | End the sundhed.dk session; `{"forgetSavedCopy": true}` deletes the copy too |
| `DELETE /saved-copy` | Delete the saved copy |

The last three change things on this server only: nothing writes to
sundhed.dk. With several people their tokens need the
`SUNDHEDMCP_API_WRITE_SCOPE` scope (in Keycloak, an optional client scope
`sundhed:write` the client asks for); a token without it reads only, which
suits an assistant such as kagent.

### Prescription renewal

`SUNDHEDMCP_ALLOW_RENEWAL=1` (chart: `allowRenewal: true`) lets a person ask
their GP to renew a prescription, as the "Forny recept" button on the
sundhed.dk medicine card does. It is the only thing SundhedMCP writes to
sundhed.dk, so it is off by default. It reads the medicine card live, so the
person must be logged in with MitID, and each request is checked against the
card as it is right then: the medicine must be one sundhed.dk offers to
renew, the package one it offers for it, and the number of packages 1 to 10.
The GP decides on the request.

| Where | |
|---|---|
| MCP | `get_renewable_prescriptions`; `renew_prescription` first returns the package sizes and sends nothing, then sends on a second call with `packageNumber`, `quantity` and `confirm: true` |
| API | `GET /renewals` (medicine and earlier requests), `GET /renewals/{id}` (package sizes), `POST /renewals` with `{"id", "packageNumber", "quantity"}`; `201` sent, `409` not logged in or cannot be renewed |
| Dashboard | `/connect/record/renewals`: a form per medicine with package, number and a tick to confirm |

With several people the MCP tool and `POST /renewals` need the
`SUNDHEDMCP_API_WRITE_SCOPE` scope, so an assistant that signs in without it
(kagent, as set up above) can list but not renew. The dashboard needs only
the person's own sign-in.

### A token for your own scripts

With one person, use one of `SUNDHEDMCP_API_TOKENS`:

```sh
curl -H "Authorization: Bearer $SUNDHEDMCP_API_TOKEN" https://sundhed.example.com/api/v1/status
```

With several people, each script needs its person's access token from the
provider. In Keycloak:

1. **Client scopes → Create**: `sundhed:write`, type *Optional*, *Include in
   token scope* on. Skip it if the realm has it already.
2. **Clients → Import client** with
   `charts/sundhedmcp/examples/keycloak-api-client.json`. It is a public
   client with only the device login on, and its mapper puts `sundhedmcp` in
   the token's audience.

Then [`scripts/sundhed-token.sh`](scripts/sundhed-token.sh) prints a token.
The first run shows a link: open it in any browser and sign in as yourself.
It keeps the refresh token in `~/.config/sundhedmcp/refresh-token` (mode
600), so later runs need no browser until that expires; `--logout` forgets it.

```sh
export SUNDHED_ISSUER=https://keycloak.example.com/realms/main
export TOKEN=$(scripts/sundhed-token.sh)
curl -H "Authorization: Bearer $TOKEN" https://sundhed.example.com/api/v1/medication-card

# The calls that change something need the write scope
TOKEN=$(SUNDHED_SCOPE="openid sundhed:write" SUNDHED_TOKEN_CACHE=~/.config/sundhedmcp/write-token scripts/sundhed-token.sh)
curl -X POST -H "Authorization: Bearer $TOKEN" https://sundhed.example.com/api/v1/refresh
```

The token is yours: it reaches only your own copy, the same one `/connect`
and your assistant use. Keep it like a password.

### The dashboard

`/connect/record` (or `/dashboard`) shows the same copy in the browser after
the `/connect` sign-in: an overview with each part's count, when it was
fetched and when sync fetches it next, one page per part with the details of
each entry, and the lab results drawn over time, with the reference range as
a band and values outside it in red. Each page can fetch its part again. It is
served from the copy, uses no script, and sends nothing to anyone but you.

Lab results are read by shape, as any object with a test name, a value that
reads as a number, and a date; results written as text are listed under
*All data* but not drawn.

## Telemetry (OpenTelemetry)

Hosted mode can send traces, metrics and logs over OTLP/HTTP to a collector.
It is off unless `SUNDHEDMCP_OTEL=1`, and local stdio mode never sends
anything. What leaves the server: route templates (`/api/v1/prescriptions/:id`,
never the id), tool names, record part names, sundhed.dk app names, status
codes, counts and durations. Never health data, CPR numbers or who is signed
in. Log lines are sent with CPR numbers, uuids, e-mail addresses and runs of
six or more digits taken out.

| Variable | Default | |
|---|---|---|
| `SUNDHEDMCP_OTEL` | | `1` turns telemetry on |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Collector base URL; `/v1/traces`, `/v1/metrics` and `/v1/logs` are added |
| `OTEL_SERVICE_NAME` | `sundhedmcp` | `service.name` |
| `SUNDHEDMCP_OTEL_SIGNALS` | `traces,metrics,logs` | Which signals to send |
| `SUNDHEDMCP_OTEL_SAMPLE_RATIO` | `1` | Share of new traces kept; a caller's `traceparent` decides for its own |
| `OTEL_METRIC_EXPORT_INTERVAL` | `30000` | Milliseconds between metric exports |

Metrics: `http.server.request.duration` (by route and status),
`sundhedmcp.tool.duration` (by tool and outcome),
`sundhedmcp.fetch.duration` (each part fetched into the saved copy),
`sundhedmcp.sundhed.request.duration` (calls to sundhed.dk, by app and
outcome) and `sundhedmcp.copies.loaded`. The chart's `perses.enabled` adds a
[Perses](https://perses.dev) dashboard for them as a ConfigMap for the Perses
provisioning sidecar.

## Kubernetes (Helm, kagent)

The chart in [`charts/sundhedmcp`](./charts/sundhedmcp) runs hosted mode in
one pod, with Chromium in it and a PVC for the password hash and the
encrypted SQLite database (the saved copy and the OAuth state). It creates the server password (and with
`apiToken.enabled` or `kagent.enabled` an API token) as Secrets kept across
upgrades; `NOTES.txt` shows how to read them.

```bash
scripts/push-image.sh   # builds linux/amd64 here; REGISTRY=<registry>/<project>
helm upgrade --install sundhedmcp charts/sundhedmcp -n sundhedmcp --create-namespace \
  --set image.repository=<registry>/<project>/sundhedmcp --set image.tag=dev-<sha>
kubectl -n sundhedmcp port-forward svc/sundhedmcp 8080
```

Then log in with MitID at `http://localhost:8080/connect` on your computer.
To reach it from elsewhere, set `httpRoute.enabled` with your Gateway's
`parentRefs` and `baseUrl` to the public URL; every path needs the password or
a token.

With `kagent.enabled: true` the chart adds a `RemoteMCPServer` (and with
`kagent.agent.enabled` an example `Agent`) in kagent's namespace. kagent sends
the API token as its `Authorization` header, from a Secret the chart copies
there. `networkPolicy.enabled` limits who reaches the pod to kagent, the helm
test and `networkPolicy.from`. See [`values.yaml`](./charts/sundhedmcp/values.yaml)
for Postgres, an existing storage key, `telemetry` and `perses`, and the rest.

Test the chart in [kind](https://kind.sigs.k8s.io/) (needs kind, helm,
kubectl and podman or docker):

```bash
scripts/kind-test.sh          # builds the image, installs each ci values file, runs helm test
scripts/kind-test.sh delete   # removes the cluster and the image
```

## Running it

- **Health.** `/healthz` answers `{"ok": true, "version": ...}` without a
  token. The chart uses it for readiness and liveness.
- **Backups.** The database (SQLite under `DATA_DIR`, or Postgres) holds only
  ciphertext. Keep the storage key apart from its backups: a key generated
  into `DATA_DIR/storage.key` sits next to the database, so set
  `SUNDHEDMCP_STORAGE_KEY` from a secret store when that matters. Losing the
  key only means the copy is fetched again at the next login.
- **Rotating the storage key.** Put the new key in `SUNDHEDMCP_STORAGE_KEY`
  and the old one in `SUNDHEDMCP_STORAGE_PREVIOUS_KEYS`. New rows are sealed
  with the new key as sync fetches them again; keep the old key listed until
  you no longer need the rows it sealed.
- **Restarts.** The sundhed.dk session lives in the server's browser, so a
  restart or a new version ends it. The saved copy stays, and the tools keep
  answering from it until the next MitID login.
- **Logs.** Log lines name a person only by the first 8 characters of their
  `callerId` and carry no record data; CPR numbers are masked everywhere.
