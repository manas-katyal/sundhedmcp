#!/usr/bin/env bash
# Prints an access token for sundhedmcp's /api/v1, from the identity provider.
# The first run signs you in with a device login: open the link it shows, in
# any browser, and sign in. The refresh token is kept (mode 600) so later runs
# need no browser until it expires.
#
#   export TOKEN=$(scripts/sundhed-token.sh)
#   curl -H "Authorization: Bearer $TOKEN" https://sundhed.example.com/api/v1/status
#
# Env: SUNDHED_ISSUER (required, e.g. https://keycloak.example.com/realms/main),
#      SUNDHED_CLIENT_ID (default sundhedmcp-api),
#      SUNDHED_SCOPE (default "openid"; add sundhed:write for the calls that change something),
#      SUNDHED_TOKEN_CACHE (default ~/.config/sundhedmcp/refresh-token).
# Flags: --logout forgets the kept refresh token.
set -euo pipefail

issuer=${SUNDHED_ISSUER:?set SUNDHED_ISSUER to the identity provider, e.g. https://keycloak.example.com/realms/main}
issuer=${issuer%/}
client_id=${SUNDHED_CLIENT_ID:-sundhedmcp-api}
scope=${SUNDHED_SCOPE:-openid}
cache=${SUNDHED_TOKEN_CACHE:-$HOME/.config/sundhedmcp/refresh-token}

if [[ ${1:-} == "--logout" ]]; then
  rm -f "$cache"
  echo "forgot the refresh token" >&2
  exit 0
fi

for tool in curl jq; do command -v "$tool" >/dev/null || { echo "needs $tool" >&2; exit 1; }; done

config=$(curl -fsS "$issuer/.well-known/openid-configuration")
token_endpoint=$(jq -r .token_endpoint <<<"$config")
device_endpoint=$(jq -r '.device_authorization_endpoint // empty' <<<"$config")

keep() {
  local refresh
  refresh=$(jq -r '.refresh_token // empty' <<<"$1")
  [[ -n $refresh ]] || return 0
  mkdir -p "$(dirname "$cache")"
  (umask 077 && printf '%s\n' "$refresh" >"$cache")
}

# A kept refresh token first: no browser needed.
if [[ -r $cache ]]; then
  if answer=$(curl -fsS "$token_endpoint" -d grant_type=refresh_token -d client_id="$client_id" --data-urlencode refresh_token@"$cache" 2>/dev/null); then
    keep "$answer"
    jq -r .access_token <<<"$answer"
    exit 0
  fi
  rm -f "$cache"
fi

[[ -n $device_endpoint ]] || { echo "$issuer offers no device login (device_authorization_endpoint)" >&2; exit 1; }
start=$(curl -fsS "$device_endpoint" -d client_id="$client_id" --data-urlencode scope="$scope")
device_code=$(jq -r .device_code <<<"$start")
interval=$(jq -r '.interval // 5' <<<"$start")
expires=$(( $(date +%s) + $(jq -r '.expires_in // 600' <<<"$start") ))
echo "Open this link and sign in:" >&2
echo "  $(jq -r '.verification_uri_complete // .verification_uri' <<<"$start")" >&2
jq -r 'if .verification_uri_complete then empty else "  code: \(.user_code)" end' <<<"$start" >&2

while (( $(date +%s) < expires )); do
  sleep "$interval"
  answer=$(curl -sS "$token_endpoint" -d grant_type=urn:ietf:params:oauth:grant-type:device_code -d client_id="$client_id" -d device_code="$device_code")
  case $(jq -r '.error // empty' <<<"$answer") in
    "")
      keep "$answer"
      jq -r .access_token <<<"$answer"
      exit 0
      ;;
    authorization_pending) ;;
    slow_down) interval=$((interval + 5)) ;;
    *)
      echo "sign-in failed: $(jq -r '.error_description // .error' <<<"$answer")" >&2
      exit 1
      ;;
  esac
done
echo "the sign-in link expired; run again" >&2
exit 1
