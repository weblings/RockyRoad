# ChartPlayer — v2 (Web / WebXR client)

A distilled version of [ChartPlayer](https://github.com/mikeoliphant/ChartPlayer) into Typescript, ThreeJS, and WebXR to run natively in browser and on XR headsets.

It reads the same [OpenSongChart](https://github.com/mikeoliphant/OpenSongChart)-format songs as
the original desktop `ChartPlayer`/`ChartConverter` apps this was distilled from.

For environment setup (Node, HTTPS certs, running the dev server, feeding it a song
library), see ["Play your own songs"](../README.md#play-your-own-songs) at the repo root.
For gotchas hit while building this project, see
[`../Analysis/lessons/README.md`](../Analysis/lessons/README.md) — the repo's single
lessons-learned location, not a doc local to this subproject. It's written primarily for AI
coding agents working in this repo, but worth a skim if you're a human onboarding too.

## Two entry points, one build

| Entry | Serves | What it is |
|---|---|---|
| `desktop.html` | Flat browser | 2D/3D note-highway player, keyboard/mouse UI |
| `xr.html` | Meta Quest (WebXR) | Same gameplay, driven by IWSDK inside a VR session |

Both are declared as separate Vite build inputs (`vite.config.ts`), share almost all
of their code from `src/shared/`, and don't share any in-memory state — navigating
from one to the other is a full page load back to that mode's library screen.

## Tech stack

**Rendering**
- [Three.js](https://threejs.org/) (via the `super-three` fork) for the 3D scene
- A custom `QuadBatch` renderer (`src/shared/QuadBatch.ts`) batches the note-highway
  sprites/text into a handful of draw calls

**XR**
- [`@iwsdk/core`](https://github.com/facebook/immersive-web-sdk) (Immersive Web SDK) —
  Meta's WebXR framework, providing the ECS, controller input, and session lifecycle
  used under `src/xr/`
- [`@iwsdk/vite-plugin-uikitml`](https://github.com/facebook/immersive-web-sdk) compiles
  the `ui/*.uikitml` panel sources into runtime UI assets under `public/ui` — every XR
  screen (library, settings, pre-scene, active, calibration) is uikit-based; an earlier
  `html2canvas`-based panel-snapshot approach was fully migrated away (the dependency is
  still in `package.json` but unused — see `Analysis/lessons/` for why)
- The IWSDK dev plugin (`@iwsdk/vite-plugin-dev`) adds an in-browser XR emulator
  (IWER) for testing without a headset

**Build tooling**
- Vite 7 + TypeScript 5, two HTML entry points (`desktop.html`, `xr.html`)
- `vite-plugin-mkcert` — WebXR requires a secure context, so even local dev runs over
  HTTPS

**Asset pipeline** (`npm run bake`, wired into `dev`/`build`)
- `tools/bake-songs.ts` scans `public/songs/` and writes `public/songs/manifest.json`,
  consumed by both the desktop and XR song browsers
- `public/ImageManifest.json` (sprite-sheet metadata for `public/UISheet0.png`) is
  checked in directly rather than generated — there's no longer a C# source project
  to bake it from, so it's hand-maintained if the sprite sheet ever changes

**Song data**
- A handful of demo songs ship in `public/songs/` for a working app out of the box
- `tools/song-server.ts` is a standalone HTTP(S) server (with CORS) for pointing the
  app at a full local song library without bundling it into the build — see
  ["Play your own songs"](../README.md#play-your-own-songs) for how to configure and run it

## Directory layout

```
v2/
  desktop.html, xr.html   entry points
  vite.config.ts          two-entry build, dev proxy, mkcert
  tools/                  bake-songs, song-server
  public/songs/           bundled demo songs + baked manifest.json
  ui/                     .uikitml XR panel sources
  src/
    shared/                song format, player, scene/rendering code used by both modes
    desktop/                desktop.html screens
    xr/                     xr.html screens, IWSDK systems
```
