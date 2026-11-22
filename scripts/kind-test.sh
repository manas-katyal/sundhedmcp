#!/usr/bin/env bash
# Install charts/sundhedmcp into a local kind cluster with each ci values file
# and run its helm tests. Builds the image from the checked-out code.
#
#   scripts/kind-test.sh           # create the cluster if needed, then test
#   KEEP=1 scripts/kind-test.sh    # leave the last release installed afterwards
#   scripts/kind-test.sh delete    # remove the cluster and the image
#
# Needs kind, helm, kubectl and podman or docker.
set -euo pipefail

CLUSTER=${CLUSTER:-sundhedmcp}
NAMESPACE=sundhedmcp
IMAGE=localhost/sundhedmcp:dev
KAGENT_VERSION=${KAGENT_VERSION:-1.0.1}
CHART=charts/sundhedmcp
cd "$(dirname "$0")/.."

engine=$(command -v podman || command -v docker)

if [[ ${1:-} == delete ]]; then
  kind delete cluster --name "$CLUSTER"
  "$engine" rmi -f "$IMAGE" 2>/dev/null || true
  "$engine" image prune -f >/dev/null
  exit
fi
ctx="kind-$CLUSTER"

if ! kind get clusters | grep -qx "$CLUSTER"; then
  kind create cluster --name "$CLUSTER" --wait 120s
fi

echo "--- image"
"$engine" build -t "$IMAGE" .
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
"$engine" save -o "$archive" "$IMAGE"
kind load image-archive "$archive" --name "$CLUSTER"

echo "--- kagent CRDs $KAGENT_VERSION"
helm --kube-context "$ctx" upgrade --install kagent-crds \
  oci://ghcr.io/kagent-dev/kagent/helm/kagent-crds --version "$KAGENT_VERSION" \
  --namespace kagent --create-namespace --wait

install() {
  echo "--- $1"
  helm --kube-context "$ctx" upgrade --install sundhedmcp "$CHART" \
    --namespace "$NAMESPACE" --create-namespace -f "$CHART/ci/$1-values.yaml" \
    --wait --timeout 4m
  helm --kube-context "$ctx" test sundhedmcp --namespace "$NAMESPACE" --logs
}

install default
install memory
install kagent

# The token kagent sends is the one the server accepts, and survived the upgrades.
token=$(kubectl --context "$ctx" -n "$NAMESPACE" get secret sundhedmcp-api-token -o jsonpath='{.data.token}' | base64 -d)
header=$(kubectl --context "$ctx" -n kagent get secret sundhedmcp-kagent -o jsonpath='{.data.authorization}' | base64 -d)
[[ $header == "Bearer $token" ]] || { echo "kagent header Secret does not match the API token" >&2; exit 1; }
kubectl --context "$ctx" -n kagent get remotemcpserver sundhedmcp -o jsonpath='{.spec.headersFrom[0].valueFrom.name}{"\n"}' | grep -qx sundhedmcp-kagent
echo "RemoteMCPServer kagent/sundhedmcp sends the API token"

# A pod outside kagent and without the client label must not get through.
if kubectl --context "$ctx" -n "$NAMESPACE" run np-check --rm -i --restart=Never \
  --image=curlimages/curl:8.17.0 -- \
  curl -s -m 5 -o /dev/null "http://sundhedmcp:8080/healthz" >/dev/null 2>&1; then
  echo "NetworkPolicy let an unlisted pod through" >&2
  exit 1
fi
echo "NetworkPolicy blocks an unlisted pod"

if [[ -z ${KEEP:-} ]]; then
  helm --kube-context "$ctx" uninstall sundhedmcp --namespace "$NAMESPACE"
fi
echo "--- all checks passed"
