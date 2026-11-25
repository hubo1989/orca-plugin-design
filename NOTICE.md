# Notices

This Orca plugin (`Orca-Design`) uses a clear MIT + Apache-2.0 open-source license boundary:

1. **Orca-Design Plugin Code & Self-Developed Assets (MIT License)**
   - The Orca plugin source code (`src/worker.js`, `src/gallery-server.mjs`, `src/runtime-manager.mjs`, `src/skills-meta.mjs`, `src/post-guard.mjs`), tools (`tools/`), templates (`templates/`), and test suite (`test/`) are licensed under the MIT License (see `LICENSE`).

2. **Open Artifact Harness SDK & On-Demand Runtime (Apache License 2.0)**
   - Bundled SDK files `src/vendor/harness-kit.mjs` and `src/vendor/harness-embed.mjs` are built from `@open-artifact/harness-kit` (`https://github.com/JimLiu/open-artifact`, Copyright 2026 Jim Liu 宝玉) under the Apache License, Version 2.0.
   - The Open Artifact runtime (`@open-artifact/cli`, defined in `vendor/runtime-manifest.json` and downloaded on demand or reused locally in `~/.agents/open-artifact/runtime/`) is licensed under the Apache License, Version 2.0.
   - See `vendor/LICENSE.open-artifact` and `vendor/NOTICE.open-artifact` for the full Apache-2.0 license text and upstream attribution.
