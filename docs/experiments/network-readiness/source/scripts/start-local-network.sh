#!/usr/bin/env bash

set -euo pipefail

CONTAINER_NAME="stellar-quickstart"
IMAGE="stellar/quickstart@sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5"
PORT=8000
RPC_URL="http://localhost:${PORT}/rpc"

# The CI builds TypeScript and installs Node dependencies before this script.
node -e "require('./dist/account'); require('@stellar/stellar-sdk')"

echo "Checking if container '${CONTAINER_NAME}' is already running..."
if [ "$(docker ps -q -f name=^/${CONTAINER_NAME}$)" ]; then
    echo "Container '${CONTAINER_NAME}' is already running. Stopping it..."
    docker stop "${CONTAINER_NAME}"
fi

if [ "$(docker ps -a -q -f name=^/${CONTAINER_NAME}$)" ]; then
    echo "Removing existing container '${CONTAINER_NAME}'..."
    docker rm -f "${CONTAINER_NAME}" || true
fi

echo "Starting ${IMAGE} in local standalone mode..."
docker run --rm -d \
  --name "${CONTAINER_NAME}" \
  -p "${PORT}:8000" \
  ${IMAGE} --local

echo "Waiting for RPC health, Friendbot funding and RPC account inclusion at ${RPC_URL}..."
if node "$(dirname "$0")/wait-for-local-network.cjs" "${RPC_URL}"; then
    exit 0
fi

echo "Error: Stellar Quickstart account/network readiness failed." >&2
docker logs "${CONTAINER_NAME}" || true
exit 1
