#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${OPENCLI_PLUGIN_DIR:-$HOME/.opencli/plugins/stockanalysis}"

mkdir -p "$TARGET_DIR"
cp "$SOURCE_DIR"/*.yaml "$TARGET_DIR"/

echo "Installed stockanalysis plugin YAMLs to: $TARGET_DIR"
