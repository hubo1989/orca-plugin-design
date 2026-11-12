#!/usr/bin/env bash
# Assemble a clean, installable plugin folder into dist/ and verify it.
#
# Usage:
#   bin/package.sh            # plugin runtime + vendored skills + thumbnail tool
#   bin/package.sh --full     # same output; kept for compatibility
#
# vendor/ is not optional: the five editors' artifact.mjs scripts are runtime
# dependencies. tools/thumb.mjs is execFile'd by the gallery server for static
# thumbnails. Omitting either used to produce a validate-passing but broken install.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${PLUGIN_DIST_DIR:-../prototype-studio-dist}"
PUBLISHER="${PLUGIN_PUBLISHER:-hubo}"
ORCA="${ORCA_CLI:-/Applications/Orca.app/Contents/Resources/bin/orca}"

if [[ $# -gt 0 && "${1:-}" != "--full" ]]; then
  echo "usage: bin/package.sh [--full]" >&2
  exit 2
fi

INCLUDE=(orca-plugin.json package.json LICENSE NOTICE.md README.md assets references src templates tools vendor)

rm -rf "$OUT"
mkdir -p "$OUT"
rsync -a --exclude '.DS_Store' --exclude '__MACOSX' "${INCLUDE[@]}" "$OUT/"

# Installed plugins derive their key from <publisher>.<id>; dev mode must not carry it.
python3 -I - "$OUT/orca-plugin.json" "$PUBLISHER" <<'EOF'
import json, sys
p, publisher = sys.argv[1], sys.argv[2]
m = json.load(open(p))
m["publisher"] = publisher
json.dump(m, open(p, "w"), indent=2, ensure_ascii=False)
EOF

# validate only checks the manifest; assert every runtime target before shipping.
python3 -I - "$OUT" <<'EOF'
import json, pathlib, sys
out = pathlib.Path(sys.argv[1])
manifest = json.loads((out / "orca-plugin.json").read_text())
required = [
    manifest["main"],
    "src/gallery-server.mjs",
    "src/gallery-ui.mjs",
    "src/builtin-library.mjs",
    "src/post-guard.mjs",
    "src/skills-meta.mjs",
    "src/examples.json",
    "tools/thumb.mjs",
    "templates/starter.proto.html",
    "references/layouts.json",
]
for skill in ("claude-slides", "claude-design", "claude-design-system", "claude-dashboard", "claude-motion"):
    required.append(f"vendor/baoyu-design/skills/{skill}/scripts/artifact.mjs")
required += [manifest["icon"], manifest["cover"]["path"]]
required += [s["path"] for s in manifest.get("screenshots", [])]
missing = [p for p in required if not (out / p).is_file()]
if missing:
    print("dist missing runtime files: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)
print(f"runtime files: OK ({len(required)} checked)")
EOF

echo "== validate =="
"$ORCA" plugin validate "$OUT" --json
echo "== inspect =="
"$ORCA" plugin inspect "$OUT" --json | python3 -I -c 'import json,sys; d=json.load(sys.stdin); r=d.get("result",{}); print("pluginKey:", r.get("plugin",{}).get("pluginKey")); print("contentHash:", r.get("contentHash")); print("valid:", r.get("valid"))'
du -sh "$OUT"
echo "dist assembled at $OUT/ (outside the plugin tree so the dev hash stays stable)"
