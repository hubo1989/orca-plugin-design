# Notices

This Orca plugin bundles code under several licenses:

- The Orca plugin code, single-file bridge (`orca-single-file-bridge.js`), inline copy editor, and test harness are licensed under the MIT License.
- The Anthropic Design canvas editor (`editor/assets/`, `editor/artifact-type/`) is adapted from Anthropic's claude.ai Artifact types. Their instructions, design assets, and icon fonts remain Anthropic's intellectual property and are not under the MIT License.
- Third-party open-source dependencies used in the editor bundle are listed in `editor/third-party-licenses.txt`.

## Vendored: baoyu-design (2026-11-06, v2.12.0)

`vendor/baoyu-design/` is a verbatim vendor of https://github.com/JimLiu/baoyu-design
(`skills/` + `LICENSE` + `NOTICE.md` + changelogs + READMEs). Its three-tier license
terms apply unchanged inside that directory; in particular the Anthropic-derived skill
instructions and editor assets are NOT MIT and remain Anthropic's IP.
See `vendor/baoyu-design/NOTICE.md` for the authoritative text.
