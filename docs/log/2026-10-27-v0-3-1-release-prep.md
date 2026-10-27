# 0.3.1 release prep

Id: 2026-10-27-v0-3-1-release-prep
Status: closed 2026-10-27 on `feat/0.3.1Prep`. Not yet merged to `dev`/`main`, `v0.3.1` tag to be made from GitHub Releases.

Version bump after the npm audit overrides merged (PR #7). Bead RockyRoad-vu4.

## What landed

- Version 0.3.1 in `package.json` and the lockfile, CHANGELOG `v0.3.1` entry.
- No app code changed since 0.3.0. The release is the `overrides` block (`@modelcontextprotocol/sdk` ^1.32.2,
  `sharp` ^0.35.5) and the lockfile refresh. Remove the overrides once IWSDK ships patched versions.

## Verification (observed 2026-10-27)

- Fresh `npm ci` reports 0 vulnerabilities. On `main` before the overrides the audit listed high and critical
  findings in dev tooling, and `zod` (high) in runtime dependencies.
- Desktop and XR were tested by the user after the clean install.

## Findings

- A `node_modules` left over from an experimental IWSDK 1.0.1 install gave a console error loading
  `@pmndrs/uikit-lucide/dist/Fingerprint.js`. The branch's overrides were not the cause. `npm ci` fixed it.
- The README Quick Start has users run `npm install` and `npm run dev`, so dev dependencies do reach users'
  machines. The release zip is a built `dist/` with no `package.json`.

## Open

- `.codex/config.toml` (IWER-generated, absolute paths) and `public/songs/manifest.json` (line endings) show as
  modified and were left out. `.iwsdk/` is untracked.
