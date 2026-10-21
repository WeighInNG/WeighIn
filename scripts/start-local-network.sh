#!/usr/bin/env bash

set -euo pipefail
#!/usr/bin/env bash

set -euo pipefail

CONTAINER_NAME="${1:-stellar-quickstart}"
PORT="${2:-8000}"
IMAGE="stellar/quickstart@sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5"
OWNER_LABEL="io.weighin.managed-by"
OWNER_VALUE="weighin-start-local-network"

if [[ ! "${CONTAINER_NAME}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
    echo "Error: Invalid container name '${CONTAINER_NAME}'. Use letters, digits, dots, underscores, or dashes and start with a letter or digit." >&2
    exit 1
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    echo "Error: Port must be a positive integer between 1 and 65535." >&2
    exit 1
fi

RPC_URL="http://localhost:${PORT}/rpc"

# The CI builds TypeScript and installs Node dependencies before this script.
node -e "require('./dist/account'); require('@stellar/stellar-sdk')"

echo "Checking if container '${CONTAINER_NAME}' is already running..."
existing_container="$(docker ps -a -q -f "name=^/${CONTAINER_NAME}$")"
if [ -n "${existing_container}" ]; then
    if ! owner="$(docker inspect --format "{{ index .Config.Labels \"${OWNER_LABEL}\" }}" "${CONTAINER_NAME}")"; then
        echo "Error: Could not verify ownership of '${CONTAINER_NAME}'; leaving it untouched." >&2
        exit 1
    fi

    if [ "${owner}" != "${OWNER_VALUE}" ] && [ "${WEIGHIN_REPLACE_UNOWNED_CONTAINER:-}" != "1" ]; then
        echo "Error: Container '${CONTAINER_NAME}' is not owned by this startup script and was left untouched." >&2
        echo "Set WEIGHIN_REPLACE_UNOWNED_CONTAINER=1 to explicitly authorize replacing it." >&2
        exit 1
    fi

    if [ "${owner}" = "${OWNER_VALUE}" ]; then
        echo "Removing owned container '${CONTAINER_NAME}'..."
    else
        echo "Explicit replacement authorized; removing '${CONTAINER_NAME}'..."
    fi
    docker rm -f "${CONTAINER_NAME}"
fi

echo "Starting ${IMAGE} in local standalone mode..."
docker run --rm -d \
  --name "${CONTAINER_NAME}" \
    --label "${OWNER_LABEL}=${OWNER_VALUE}" \
  -p "${PORT}:8000" \
  ${IMAGE} --local

echo "Waiting for RPC health, Friendbot funding and RPC account inclusion at ${RPC_URL}..."
if node "$(dirname "$0")/wait-for-local-network.cjs" "${RPC_URL}"; then
    exit 0
fi

echo "Error: Stellar Quickstart account/network readiness failed." >&2
docker logs "${CONTAINER_NAME}" || true
exit 1
