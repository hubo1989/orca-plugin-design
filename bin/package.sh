#!/usr/bin/env bash
# Assemble a clean, installable plugin folder into dist/ and verify it (Plan B thin-shell < 8 MiB).
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${PLUGIN_DIST_DIR:-../prototype-studio-dist}"
PUBLISHER="${PLUGIN_PUBLISHER:-hubo}"
ORCA="${ORCA_CLI:-/Applications/Orca.app/Contents/Resources/bin/orca}"

if [[ $# -gt 0 && "${1:-}" != "--full" ]]; then
  echo "usage: bin/package.sh [--full]" >&2
  exit 2
fi

INCLUDE=(orca-plugin.json package.json LICENSE NOTICE.md README.md assets custom-types references src templates tools vendor)

rm -rf "$OUT"
mkdir -p "$OUT"
rsync -a --exclude '.DS_Store' --exclude '__MACOSX' --exclude 'node_modules' "${INCLUDE[@]}" "$OUT/"

# Installed plugins derive their key from <publisher>.<id>; dev mode must not carry it.
python3 -I - "$OUT/orca-plugin.json" "$PUBLISHER" <<'EOF'
import json, sys
p, publisher = sys.argv[1], sys.argv[2]
m = json.load(open(p))
m["publisher"] = publisher
json.dump(m, open(p, "w"), indent=2, ensure_ascii=False)
EOF

# Verify required runtime files, zero legacy/forbidden assets, zero forbidden licenses, and < 8 MiB size limit.
python3 -I - "$OUT" <<'EOF'
import json, pathlib, sys

out = pathlib.Path(sys.argv[1])
manifest = json.loads((out / "orca-plugin.json").read_text())

required = [
    manifest["main"],
    "src/columns-store.mjs",
    "src/export-render.mjs",
    "src/extra-types.mjs",
    "src/gallery-server.mjs",
    "src/runtime-manager.mjs",
    "src/post-guard.mjs",
    "src/skills-meta.mjs",
    "src/voice-store.mjs",
    "src/examples.json",
    "src/vendor/harness-kit.mjs",
    "src/vendor/harness-embed.mjs",
    "vendor/runtime-manifest.json",
    "vendor/LICENSE.open-artifact",
    "vendor/NOTICE.open-artifact",
    "vendor/humanizer-zh/LICENSE",
    "vendor/humanizer-zh/SKILL.md",
    "custom-types/social-cards/artifact-type.json",
    "custom-types/social-cards/index.html",
    "custom-types/long-page/artifact-type.json",
    "custom-types/long-page/index.html",
    "tools/thumb.mjs",
    "tools/vendor-open-artifact.mjs",
    "templates/starter.proto.html",
    "references/layouts.json",
    manifest["icon"],
    manifest["cover"]["path"],
]
required += [s["path"] for s in manifest.get("screenshots", [])]
missing = [p for p in required if not (out / p).is_file()]
if missing:
    print("dist missing runtime files: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)

forbidden_paths = [
    "vendor/open-artifact-runtime.tgz",
    "vendor/baoyu-design",
    "vendor/manifest.json",
    "vendor-rewrites.json",
    "tools/vendor-baoyu.mjs",
    "node_modules",
]
for fp in forbidden_paths:
    if (out / fp).exists():
        print(f"dist contains forbidden asset: {fp}", file=sys.stderr)
        sys.exit(1)

for tgz in out.rglob("open-artifact-runtime.tgz"):
    print(f"dist contains forbidden tarball: {tgz}", file=sys.stderr)
    sys.exit(1)

forbidden_terms = [
    "LicenseRef-" + "Mixed",
    "Anthro" + "pic's intellectual property",
    "Anthro" + "pic",
    "AG" + "PL",
]
total_bytes = 0
for f in out.rglob("*"):
    if not f.is_file():
        continue
    total_bytes += f.stat().st_size
    if f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff2", ".wasm"}:
        continue
    try:
        txt = f.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    for term in forbidden_terms:
        if term in txt:
            print(f"dist contains forbidden term {term!r} in {f.relative_to(out)}", file=sys.stderr)
            sys.exit(1)

max_bytes = 8 * 1024 * 1024
print(f"runtime files: OK ({len(required)} checked), totalBytes={total_bytes} ({total_bytes / (1024 * 1024):.2f} MiB)")
if total_bytes >= max_bytes:
    print(f"dist size {total_bytes} exceeds 8 MiB limit ({max_bytes})", file=sys.stderr)
    sys.exit(1)
EOF

echo "== validate =="
"$ORCA" plugin validate "$OUT" --json
echo "== inspect =="
"$ORCA" plugin inspect "$OUT" --json | python3 -I -c 'import json,sys; d=json.load(sys.stdin); r=d.get("result",{}); print("pluginKey:", r.get("plugin",{}).get("pluginKey")); print("contentHash:", r.get("contentHash")); print("valid:", r.get("valid")); sys.exit(0 if r.get("valid") is True else 1)'
du -sh "$OUT"
echo "dist assembled at $OUT/ (outside the plugin tree so the dev hash stays stable)"
