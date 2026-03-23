#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${OPENCLI_PLUGIN_DIR:-$HOME/.opencli/plugins/stockanalysis}"

mkdir -p "$TARGET_DIR"
find "$TARGET_DIR" -maxdepth 1 \( -name '*.yaml' -o -name '*.yml' \) -delete
cp "$SOURCE_DIR"/*.js "$TARGET_DIR"/

echo "Installed stockanalysis plugin files to: $TARGET_DIR"
