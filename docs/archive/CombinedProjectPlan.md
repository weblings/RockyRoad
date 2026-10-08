# Combined Project Plan — v1 + XRProto → Single Build

Goal: merge `ThreeCP/v1` (flat browser app) and `ThreeCP/XRProto` (Quest VR app) into
a single Vite project with two entry points. An "Enter VR" button on the v1 library
screen navigates to `xr.html`; an "Exit VR" button on the XRProto library screen
navigates back to `desktop.html`. No shared in-memory state between modes — each
starts fresh at the library screen.

This is **Path A** from the broader architecture discussion. It avoids fighting the
IWSDK renderer ownership problem by treating the two modes as separate pages in one
build rather than one page with two render loops.

---

## Why the files diverge today

The largest source of divergence is the **local-Z refactor** that XRProto underwent.
XRProto rewrote the coordinate system so the now-line always sits at local Z=0 and
geometry scrolls toward it. v1 kept the original absolute-Z approach where `time *
-timeScale` maps directly to Z and the camera moves instead. The XRProto approach is
strictly required for VR (the HMD camera can't be moved programmatically) and is
architecturally cleaner, so XRProto's versions of the affected files should be
canonical in the combined project.

---

## Divergence audit (per file)

Files are grouped by how much work is needed.

### Trivially identical (whitespace / ordering only)
| File | Note |
|------|------|
| `MathUtil.ts` | Trailing newline difference only |
| `UIColor.ts` | `fromHex` appears in a different position; content identical |
| `Settings.ts` | Already in sync across both projects |

### One side is a clean superset (additive only)
| File | Who has more | What to add to the other side |
|------|-------------|-------------------------------|
| `SongPlayer.ts` | v1 | `SilentPlayer` class — XRProto doesn't have it; add to canonical |
| `ChartScene3D.ts` | XRProto | `toZ()` helper + its usage; v1 still uses `time * -timeScale` directly |
| `FretPlayerScene3D.ts` | Both | XRProto adds `syncCameraTo()`, `toZ()` calls throughout, connector-line guard; v1 adds `leftyMode` setter — canonical is XRProto base + cherry-pick from v1 |
| `KeysPlayerScene3D.ts` | v1 | Top-down camera, piano image mesh (`syncPianoMesh`), `fullKeyboard` toggle, `key%12` layout fix — v1 is the clear canonical |

### Require per-chunk audit before merging
These have 100–385 changed lines, primarily from the local-Z refactor rippling
through, but may also contain independent changes on either side.

| File | Changed lines | Expected cause |
|------|--------------|----------------|
| `Camera3D.ts` | 199 | Local-Z refactor (camera no longer needs to translate in Z) |
| `Scene3D.ts` | 385 | Local-Z refactor + possibly TextBatch integration (v1 only) |
| `FretCamera.ts` | 98 | Local-Z refactor (camera anchored at Z=0 in XRProto) |
| `QuadBatch.ts` | 269 | Local-Z refactor (vertex Z computation changed) |
| `UIImage.ts` | 111 | Unknown — needs diff read |
| `NoteUtil.ts` | 107 | Unknown — needs diff read |
| `SongFormat.ts` | 220 | v1 added `Sections?` optional field, `Hand` on keyboard note; XRProto may have other additions |

**Before moving any files, read and annotate the diff for each of these seven files.**
Classify each changed chunk as: (a) local-Z refactor → XRProto wins, (b) v1 addition
→ port into canonical, (c) genuine conflict → resolve explicitly.

---

## Target directory structure

```
ThreeCP/Combined/
  package.json          ← merged deps (see below)
  tsconfig.json         ← merged
  vite.config.ts        ← two entry points; conditional IWSDK plugins
  desktop.html          ← v1's index.html (renamed)
  xr.html               ← XRProto's index.html
  public/               ← union of both projects' public/ folders
    UISheet0.png
    ImageManifest.json
    songs/
      manifest.json     ← XRProto's song manifest (v1 doesn't use this)
      ...               ← per-song folders
  tools/
    bake-manifest.ts    ← from v1
    bake-songs.ts       ← from XRProto
  src/
    shared/             ← single canonical copy; both entry points import from here
      SongPlayer.ts         ← XRProto + SilentPlayer (from v1)
      SilentPlayer.ts       ← (or keep in SongPlayer.ts — either is fine)
      SongFormat.ts         ← audited merge
      SongIndex.ts          ← v1 only (XRProto uses manifest.json / XRSongLibrary)
      Settings.ts           ← either (in sync)
      UIColor.ts            ← either (identical)
      MathUtil.ts           ← either (identical)
      UIImage.ts            ← audited merge
      NoteUtil.ts           ← audited merge
      Camera3D.ts           ← audited merge
      Scene3D.ts            ← audited merge
      QuadBatch.ts          ← audited merge
      FretCamera.ts         ← audited merge
      ChartScene3D.ts       ← XRProto (has toZ())
      FretPlayerScene3D.ts  ← XRProto base + leftyMode setter from v1
      KeysPlayerScene3D.ts  ← v1 (top-down, piano image, key%12 fix)
      TextBatch.ts          ← v1 only (XRProto has no text rendering)
      NoteDetector.ts       ← v1 only
      PitchDetector.ts      ← v1 only
    desktop/            ← v1 app + screens (imports from ../shared/)
      App.ts
      main.ts
      SongLibraryScreen.ts
      PreSceneScreen.ts
      ActiveSceneScreen.ts
      TunerScreen.ts
      assets/
    xr/                 ← XRProto app + screens (imports from ../shared/)
      index.ts
      XRSongLibrary.ts
      XRPreScene.ts
      XRActiveScene.ts
      XRSettingsScene.ts
      CalibrationSystem.ts
      XRTypes.ts
      screens/           ← CSS files
      assets/
```

---

## package.json merge

Key decisions:

**`three` version** — XRProto uses `"three": "npm:super-three@0.181.0"` (Meta's WebXR
fork; required by IWSDK). v1 uses `three@0.183.2`. All shared scene files import from
`three` directly, so they must resolve to the same package.

- First check if `super-three@0.183.x` exists. Meta tracks upstream closely and a
  matching version is likely available.
- If not, audit v1 for any Three.js API introduced after 0.181 before downgrading.
- The combined `package.json` sets `"three": "npm:super-three@<matched-version>"`.

Merged deps (approximate):

```json
{
  "name": "chartplayer-combined",
  "type": "module",
  "scripts": {
    "dev": "npm run bake && vite",
    "dev:device": "npm run bake && vite --mode device",
    "build": "npm run bake && tsc && vite build",
    "bake": "tsx tools/bake-manifest.ts && tsx tools/bake-songs.ts"
  },
  "dependencies": {
    "@iwsdk/core": "0.3.1",
    "html2canvas": "^1.4.1",
    "three": "npm:super-three@<version>"
  },
  "devDependencies": {
    "@felixtz/iwsdk-rag-mcp": "^0.3.1",
    "@iwsdk/vite-plugin-dev": "0.3.1",
    "@iwsdk/vite-plugin-uikitml": "0.3.1",
    "@meta-quest/hzdb": "^1.0.0",
    "@types/three": "*",
    "@types/wicg-file-system-access": "^2023.10.7",
    "cross-env": "^10.1.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.0",
    "vite": "^7.x",
    "vite-plugin-mkcert": "^1.17.0"
  }
}
```

---

## vite.config.ts merge

```ts
import { iwsdkDev }       from "@iwsdk/vite-plugin-dev";
import { compileUIKit }   from "@iwsdk/vite-plugin-uikitml";
import { defineConfig }   from "vite";
import mkcert             from "vite-plugin-mkcert";

export default defineConfig(({ mode }) => {
  const deviceMode  = mode === "device";

  return {
    plugins: [
      mkcert(),
      // IWSDK emulator: skip in device mode; harmless on desktop.html (only
      // activates when World.create() is called, which desktop.html never does).
      ...(deviceMode ? [] : [
        iwsdkDev({
          emulator: { device: "metaQuest3" },
          ai: { tools: ["claude", "cursor", "copilot", "codex"] },
          verbose: true,
        }),
      ]),
      compileUIKit({ sourceDir: "ui", outputDir: "public/ui", verbose: true }),
    ],
    server: {
      host: "0.0.0.0",
      port: 8081,
      open: "desktop.html",
      fs: {
        allow: [
          ".",
          "D:/Users/Andrew/Documents/Coding/MusicThing/dlc",
          "D:/Users/Andrew/Documents/Coding/MusicThing/ChartPlayer/ChartPlayerShared",
          "D:/Users/Andrew/Documents/Coding/MusicThing/ChartPlayer/ThreeCP/Project/public",
          "C:/Users/mewuz/Music/Charts",
        ],
      },
    },
    build: {
      outDir: "dist",
      sourcemap: mode !== "production",
      target: "esnext",
      rollupOptions: {
        input: {
          desktop: "desktop.html",
          xr:      "xr.html",
        },
      },
    },
    esbuild: { target: "esnext" },
    optimizeDeps: {
      exclude: ["@babylonjs/havok"],
      esbuildOptions: { target: "esnext" },
    },
    publicDir: "public",
    base: "./",
  };
});
```

---

## Steps in execution order

### Step 1 — Audit the seven large-divergence files
Before creating any new files. For each of `Camera3D`, `Scene3D`, `FretCamera`,
`QuadBatch`, `UIImage`, `NoteUtil`, `SongFormat`: read the full diff and annotate
each chunk as local-Z refactor / v1 addition / conflict. Output: a concrete list of
merge tasks.

### Step 2 — Resolve the super-three version
Check npm for `super-three@0.183.x`. If available, use it. If not, search v1's source
for any Three.js API that post-dates 0.181 and decide whether to upgrade or work
around. Unblocks package.json.

### Step 3 — Create project skeleton
New folder `ThreeCP/Combined/`. Write `package.json`, `tsconfig.json`, `vite.config.ts`,
and empty `src/shared/`, `src/desktop/`, `src/xr/` directories. Run `npm install`.

### Step 4 — Populate src/shared/
Copy and merge files in easiest-first order:
1. Trivially identical: `MathUtil`, `UIColor`, `Settings`
2. Clean superset: `SongPlayer` (add `SilentPlayer`), `ChartScene3D` (XRProto), `KeysPlayerScene3D` (v1)
3. Files from Step 1 audit: `SongFormat`, `UIImage`, `NoteUtil`, `Camera3D`, `FretCamera`, `QuadBatch`, `Scene3D`
4. Merge `FretPlayerScene3D` (XRProto base + `leftyMode` from v1)
5. v1-only files: `SongIndex`, `TextBatch`, `NoteDetector`, `PitchDetector`

After each file: `npx tsc --noEmit` to catch import/type errors early.

### Step 5 — Populate src/desktop/
Copy v1's `App.ts`, screens, `main.ts`, `assets/`, `desktop.html`. Rewrite all
imports from `'./Foo'` to `'../shared/Foo'` (or `'../../shared/Foo'` from
sub-directories). Type-check after.

### Step 6 — Populate src/xr/
Copy XRProto's `index.ts`, XR screens, `assets/`, CSS, `xr.html`. Rewrite imports
to `'../shared/Foo'`. Type-check after.

### Step 7 — Merge public/ assets
Union of both projects' `public/` folders. Ensure `UISheet0.png`,
`ImageManifest.json`, and `songs/manifest.json` are all present.

### Step 8 — Add Enter VR / Exit VR buttons (see below)

### Step 9 — Full verify
`npx tsc --noEmit`, then `vite dev`, then manually confirm both `desktop.html` and
`xr.html` boot correctly.

---

## Enter VR / Exit VR buttons

Both buttons live in the **top-right corner of the library screen** header.

### "Enter VR" — v1's SongLibraryScreen

Added to the library header bar alongside the existing sort control. Only rendered
when the browser supports immersive-vr:

```ts
// After building the header HTML, async-check XR support:
if ('xr' in navigator) {
    navigator.xr!.isSessionSupported('immersive-vr').then(supported => {
        if (supported) {
            (container.querySelector('#enter-vr') as HTMLElement).style.display = '';
        }
    });
}
```

HTML (added to the header row, right-aligned):

```html
<button id="enter-vr" class="active-back-btn" style="display:none"
        onclick="location.href='xr.html'">
  <!-- VR headset SVG icon -->
  <span>Enter VR</span>
</button>
```

### "Exit VR" — XRProto's XRSongLibrary

Added to the panel HTML passed to `xrButtons`. Always visible (if you're looking at
the XR library, you're in VR):

```ts
// In XRSongLibrary.show() panel HTML:
`<button class="button primary-dark icon-btn" id="exit-vr"
         style="margin-left:auto">Desktop</button>`

// Registered with xrButtons so the ray-cast system picks it up:
xrButtons.push({
  el: document.getElementById('exit-vr')!,
  onClick: () => { location.href = 'desktop.html'; },
});
```

The click navigates back to `desktop.html` in the same tab. The XR session ends
automatically when the page unloads.

---

## Open risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `super-three` version gap (0.181 vs 0.183) | Medium | Check for matching version first; audit v1 APIs if needed (Step 2) |
| Local-Z refactor breaks v1 rendering when shared files are swapped | High if rushed | Migrate file-by-file; type-check and smoke-test after each |
| Import path churn (`./Foo` → `../shared/Foo`) — easy to miss one | Certain | TypeScript will catch it; do one file at a time |
| IWSDK dev plugin affecting desktop.html behaviour | Low | Plugin only activates inside `World.create()`, which desktop never calls |
| `compileUIKit` plugin failing if `ui/` source dir doesn't exist | Medium | Create an empty `ui/` directory or make the plugin path conditional |

---

## What this plan defers

- **State handoff** — entering VR always starts at the library. If a song is playing
  in desktop mode, VR starts fresh. Implementing handoff (e.g. via `sessionStorage`)
  is a follow-on task once the combined project is stable.
- **True in-page switching** (Path B) — requires changing IWSDK's `offer: "always"`
  to manual session entry and handling session-end events to swap canvases. Not needed
  for Path A.
- **Replacing IWSDK** (Path C) — out of scope; only relevant if IWSDK becomes a
  maintenance problem.
