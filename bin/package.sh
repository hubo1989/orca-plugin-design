#!/usr/bin/env bash
# Assemble a clean, installable plugin folder into dist/ and verify it.
#
# Usage:
#   bin/package.sh            # lite: plugin runtime only
#   bin/package.sh --full     # full: also bundle vendor/ (baoyu-design skills)
#
# dist/ layout is what an installed plugin folder looks like:
#   orca-plugin.json, package.json, LICENSE, NOTICE.md, README.md, src/, templates/ [, vendor/]
# The publisher field is injected at package time (installed plugins need <publisher>.<id>);
# dev mode keeps the repo manifest untouched so local.prototype-studio stays stable.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${PLUGIN_DIST_DIR:-../prototype-studio-dist}"
PUBLISHER="${PLUGIN_PUBLISHER:-hubo}"
ORCA="${ORCA_CLI:-/Applications/Orca.app/Contents/Resources/bin/orca}"

INCLUDE=(orca-plugin.json package.json LICENSE NOTICE.md README.md assets references src templates)
if [[ "${1:-}" == "--full" ]]; then
  INCLUDE+=(vendor)
fi

rm -rf "$OUT"
mkdir -p "$OUT"
rsync -a --exclude '.DS_Store' --exclude '__MACOSX' "${INCLUDE[@]}" "$OUT/"

# Installed plugins derive their key from <publisher>.<id>; dev mode must not carry it.
python3 - "$OUT/orca-plugin.json" "$PUBLISHER" <<'EOF'
import json, sys
p, publisher = sys.argv[1], sys.argv[2]
m = json.load(open(p))
m["publisher"] = publisher
json.dump(m, open(p, "w"), indent=2, ensure_ascii=False)
EOF

echo "== validate =="
"$ORCA" plugin validate "$OUT" --json
echo "== inspect =="
"$ORCA" plugin inspect "$OUT" --json | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("result",{}); print("pluginKey:", r.get("plugin",{}).get("pluginKey")); print("contentHash:", r.get("contentHash")); print("valid:", r.get("valid"))'
du -sh "$OUT"
echo "dist assembled at $OUT/ (outside the plugin tree so the dev hash stays stable)"
