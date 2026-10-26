#!/bin/zsh
# The bridge as a Claude Desktop extension: dist/font-scout.mcpb, from extension/manifest.json, the bridge's code
# and the icon. Opening the file in Claude Desktop installs it.
#   ./scripts/pack-extension.sh
set -euo pipefail
cd "${0:A:h}/.."
STAGE=$(mktemp -d)
cp -R bin lib package.json LICENSE "$STAGE/"
cp extension/manifest.json "$STAGE/manifest.json"
cp assets/icon-128.png "$STAGE/icon.png"
mkdir -p dist
npx -y @anthropic-ai/mcpb pack "$STAGE" dist/font-scout.mcpb
rm -r "$STAGE"
