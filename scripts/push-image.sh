#!/usr/bin/env bash
# Build the image for linux/amd64 on this machine and push it, with the chart,
# to a registry. Both are tagged after the checked-out commit:
#
#   <REGISTRY>/sundhedmcp:dev-<sha>
#   oci://<REGISTRY>/charts/sundhedmcp:0.1.0-dev-<sha>
#
#   scripts/push-image.sh
#   REGISTRY=registry.example.com/team scripts/push-image.sh
#   PUSH_IP=192.168.1.10 scripts/push-image.sh   # push past a proxy that limits uploads
#
# PUSH_IP points the registry's hostname at that address while the image is
# pushed (for podman, inside the podman machine), for a registry behind a proxy
# such as Cloudflare that refuses the Chromium layer (over 100 MB). The chart
# goes the normal way.
#
# Needs podman or docker and helm, logged in to the registry. The working
# tree must be clean, so the tag names the code that was built.
set -euo pipefail

REGISTRY=${REGISTRY:-registry.kubehive.io/dev-projects}
PLATFORM=${PLATFORM:-linux/amd64}
cd "$(dirname "$0")/.."

engine=$(command -v podman || command -v docker)
if [[ -n $(git status --porcelain) ]]; then
  echo "The working tree has changes; commit or stash them first." >&2
  exit 1
fi
sha=$(git rev-parse --short HEAD)
image="$REGISTRY/sundhedmcp:dev-$sha"
host=${REGISTRY%%/*}

echo "--- build $image ($PLATFORM)"
"$engine" build --platform "$PLATFORM" -t "$image" .

echo "--- push $image"
if [[ -n ${PUSH_IP:-} && $engine == *podman ]]; then
  mark="# sundhedmcp push-image"
  podman machine ssh "echo '$PUSH_IP $host $mark' | sudo tee -a /etc/hosts >/dev/null"
  trap "podman machine ssh \"sudo sed -i '/$mark/d' /etc/hosts\"" EXIT
elif [[ -n ${PUSH_IP:-} ]]; then
  echo "PUSH_IP is only supported with podman; add '$PUSH_IP $host' to /etc/hosts yourself." >&2
  exit 1
fi
"$engine" push "$image"

echo "--- chart"
out=$(mktemp -d)
helm package charts/sundhedmcp --version "0.1.0-dev-$sha" --app-version "dev-$sha" -d "$out" >/dev/null
auth=()
for f in "${XDG_CONFIG_HOME:-$HOME/.config}/containers/auth.json" "${XDG_RUNTIME_DIR:-/nonexistent}/containers/auth.json"; do
  if [[ $engine == *podman && -f $f ]]; then
    auth=(--registry-config "$f")
    break
  fi
done
helm push "$out/sundhedmcp-0.1.0-dev-$sha.tgz" "oci://$REGISTRY/charts" ${auth[@]+"${auth[@]}"}
rm -rf "$out"

echo "--- done: image $image, chart 0.1.0-dev-$sha"
