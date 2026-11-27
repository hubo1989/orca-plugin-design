#!/usr/bin/env bash
# Assemble clean, installable plugin folders for LKL-PMStudio and/or Orca and verify them.
#
# Usage:
#   bin/package.sh                    # builds both pmstudio and orca targets (--target all)
#   bin/package.sh --full             # same as --target all; kept for compatibility
#   bin/package.sh --target pmstudio  # builds LKL-PMStudio package with contributes.pages
#   bin/package.sh --target orca      # builds Orca compatible package (strips contributes.pages)
#   bin/package.sh --target all       # builds both targets
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)
      TARGET="all"
      shift
      ;;
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    *)
      echo "usage: bin/package.sh [--full | --target pmstudio|orca|all]" >&2
      exit 2
      ;;
  esac
done

case "$TARGET" in
  pmstudio|orca|all) ;;
  *)
    echo "invalid --target: $TARGET (expected pmstudio|orca|all)" >&2
    exit 2
    ;;
esac

node tools/sync-gallery-page.mjs --check

OUT_PMS="${PLUGIN_DIST_DIR:-../prototype-studio-dist}"
OUT_ORCA="${PLUGIN_DIST_ORCA_DIR:-../prototype-studio-dist-orca}"
PUBLISHER="${PLUGIN_PUBLISHER:-hubo}"
ORCA="${ORCA_CLI:-/Applications/Orca.app/Contents/Resources/bin/orca}"
PMS="${PMS_CLI:-/Applications/LKL-PMStudio.app/Contents/Resources/bin/pms}"
SKIP_CLI="${ORCA_PACKAGE_SKIP_CLI:-0}"

INCLUDE=(orca-plugin.json package.json LICENSE NOTICE.md README.md assets references src templates tools vendor)

build_target() {
  local mode="$1"
  local out="$2"
  rm -rf "$out"
  mkdir -p "$out"
  rsync -a --exclude '.DS_Store' --exclude '__MACOSX' "${INCLUDE[@]}" "$out/"

  python3 -I - "$out/orca-plugin.json" "$PUBLISHER" "$mode" <<'EOF'
import json, sys
p, publisher, mode = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(p))
m["publisher"] = publisher
if mode == "orca":
    m.setdefault("engines", {})["orca"] = ">=1.4.248"
    if isinstance(m.get("contributes"), dict):
        m["contributes"].pop("pages", None)
json.dump(m, open(p, "w"), indent=2, ensure_ascii=False)
EOF

  python3 -I - "$out" "$mode" <<'EOF'
import json, pathlib, sys
out = pathlib.Path(sys.argv[1])
mode = sys.argv[2]
manifest = json.loads((out / "orca-plugin.json").read_text())
required = [
    manifest["main"],
    "src/gallery-server.mjs",
    "src/gallery-ui.mjs",
    "src/builtin-library.mjs",
    "src/post-guard.mjs",
    "src/skills-meta.mjs",
    "src/workspace-guard.mjs",
    "src/examples.json",
    "tools/thumb.mjs",
    "templates/starter.proto.html",
    "references/layouts.json",
]
if mode == "pmstudio":
    required.append("src/gallery-page.html")
    for page in manifest.get("contributes", {}).get("pages", []):
        if page.get("entry"):
            required.append(page["entry"])
for skill in ("claude-slides", "claude-design", "claude-design-system", "claude-dashboard", "claude-motion"):
    required.append(f"vendor/baoyu-design/skills/{skill}/scripts/artifact.mjs")
required += [manifest["icon"], manifest["cover"]["path"]]
required += [s["path"] for s in manifest.get("screenshots", [])]
missing = [p for p in required if not (out / p).is_file()]
if missing:
    print(f"[{mode}] dist missing runtime files: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)
print(f"[{mode}] runtime files: OK ({len(required)} checked)")
EOF

  local cli_bin=""
  if [[ "$mode" == "pmstudio" ]]; then
    if [[ -x "$PMS" ]]; then
      cli_bin="$PMS"
    elif command -v pms >/dev/null 2>&1; then
      cli_bin="$(command -v pms)"
    fi
  else
    if [[ -x "$ORCA" ]]; then
      cli_bin="$ORCA"
    elif command -v orca >/dev/null 2>&1; then
      cli_bin="$(command -v orca)"
    fi
  fi

  if [[ "$SKIP_CLI" == "1" || -z "$cli_bin" ]]; then
    echo "== [$mode] CLI validate skipped (SKIP_CLI=$SKIP_CLI, cli=${cli_bin:-none}) =="
  else
    echo "== [$mode] validate ($cli_bin) =="
    "$cli_bin" plugin validate "$out" --json
    echo "== [$mode] inspect ($cli_bin) =="
    "$cli_bin" plugin inspect "$out" --json | python3 -I -c 'import json,sys; d=json.load(sys.stdin); r=d.get("result",{}); print("pluginKey:", r.get("plugin",{}).get("pluginKey")); print("contentHash:", r.get("contentHash")); print("valid:", r.get("valid"))'
  fi
  du -sh "$out"
  echo "[$mode] dist assembled at $out/"
}

if [[ "$TARGET" == "pmstudio" || "$TARGET" == "all" ]]; then
  build_target "pmstudio" "$OUT_PMS"
fi
if [[ "$TARGET" == "orca" || "$TARGET" == "all" ]]; then
  build_target "orca" "$OUT_ORCA"
fi
