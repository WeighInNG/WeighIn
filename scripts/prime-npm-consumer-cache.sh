#!/usr/bin/env bash

set -euo pipefail

prime_dir="$(mktemp -d "${RUNNER_TEMP:?RUNNER_TEMP is required}/weighin-npm-prime.XXXXXX")"
trap 'rm -rf "$prime_dir"' EXIT

npm pack --ignore-scripts --pack-destination "$prime_dir" >/dev/null
mkdir "$prime_dir/consumer"
printf '%s\n' '{"name":"weighin-cache-prime","version":"1.0.0","private":true}' > "$prime_dir/consumer/package.json"
npm install --offline=false --ignore-scripts --no-audit --no-fund --prefix "$prime_dir/consumer" "$prime_dir"/*.tgz
