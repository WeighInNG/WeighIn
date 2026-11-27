#!/usr/bin/env bash
# Clean build artifacts, coverage reports, test outputs, and temporary caches.
#
# Usage: ./scripts/clean.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Cleaning build artifacts and temporary caches in WeighIn..."

# Directories to remove safely
TARGET_DIRS=(
    "dist"
    "coverage"
    ".vitest"
    ".cache"
    "contract/target"
    "native/simulation/target"
)

for dir in "${TARGET_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo "  Removing directory: $dir/"
        rm -rf "$dir"
    fi
done

# Temporary benchmark and report files
TARGET_FILES=(
    "weighin-results.json"
    "weighin-report.md"
    "pr-metadata.json"
    ".weighin-temp-key"
)

for file in "${TARGET_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  Removing temporary file: $file"
        rm -f "$file"
    fi
done

echo "Clean completed successfully."
