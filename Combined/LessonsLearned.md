# Lessons Learned — Combined Project

Gotchas and hard-won decisions specific to the Combined (desktop + XR) project. For XRProto-only issues (/@fs/ cross-drive, IWSDK grab API, ADB debugging) see `ThreeCP/Analysis/LessonsLearned.md`.

---

## `Scene3D.xrMode = true` must be set before any scene construction

**Symptom:** XR scenes create an owned `THREE.Scene`, add the QuadBatch mesh to it, then fail when IWSDK tries to register the same mesh — or the mesh renders twice.

**Root cause:** `Scene3D.xrMode` is a static flag checked in the constructor. Any code path that constructs a `Scene3D` subclass before the flag is set will create a `THREE.Scene` and add the mesh to it.

**Fix:** Set `Scene3D.xrMode = true` at the very top of `src/xr/index.ts`, before any other imports that could transitively construct a scene. It's the first executable line in the XR entry point.

---

## `verbatimModuleSyntax` requires `import type` for every type-only import

**Symptom:** `error TS1484: 'AssetManifest' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.`

**Root cause:** `verbatimModuleSyntax` requires that any symbol used only as a type in the current file be imported with `import type` or `import { type X }`. Importing it as a value triggers an error even if it happens to be erased at runtime.

**Fix:** Use `import { type AssetManifest, ... }` (inline `type` keyword per symbol) or `import type { ... }` for the whole import. Watch for this any time you import an interface or type alias from a module that also exports values.

---

## Unused imports from `Settings` cause `noUnusedLocals` errors

**Symptom:** `error TS6133: 'saveSettings' is declared but its value is never read.`

**Root cause:** `index.ts` imported `saveSettings` because the v1 version used it directly. In the Combined XR path, `XRSettingsScene` owns that call internally — `index.ts` only needs `loadSettings`.

**Fix:** Remove unused named imports. Check every import you carry over from a source file against what the destination file actually calls.

---

## Vite two-entry build: both HTML files must be in `rollupOptions.input`

**Symptom:** Navigating to `xr.html` returns Vite's SPA fallback (200 with `text/html` index.html content) instead of the XR page.

**Root cause:** Vite only serves pages listed in `rollupOptions.input` as distinct entry points. An HTML file in the project root is not automatically served as a page.

**Fix:**
```ts
rollupOptions: {
    input: {
        desktop: "desktop.html",
        xr:      "xr.html",
    },
},
```
Script tags inside each HTML must use absolute paths from project root: `src="/src/xr/index.ts"`, not relative.

---

## `QuadBatch.flush()` vs `draw()` — never call `renderer.render()` inside XR

**Symptom:** Black screen or flickering in XR; IWSDK compositor fight.

**Root cause:** IWSDK owns the render loop and calls `renderer.render()` on its schedule. Calling it again inside `Scene3D.draw()` submits a duplicate frame.

**Fix:** Split into `flush()` (marks GPU buffers dirty, sets draw range) and `draw()` (calls `flush()` then `renderer.render()`). In XR mode (`threeScene === null`), call `flush()` only. In desktop mode, call `draw()`.

---

## `KeysPlayerScene3D` in Combined uses XRProto's constructor (no Camera3D arg)

**Symptom:** Desktop `ActiveSceneScreen` passes a `Camera3D` that `KeysPlayerScene3D` no longer accepts — build error or silent mismatch.

**Root cause:** v1's `KeysPlayerScene3D` took an explicit `Camera3D` parameter. XRProto's version creates the camera internally. Combined uses XRProto's constructor as canonical.

**Fix:** Remove `Camera3D` construction from `ActiveSceneScreen`. Construct `KeysPlayerScene3D` with just `(renderer, texture, songStructure, keyboardNotes)`. The internal camera reads viewport size from `renderer.getSize()`.

---

## Piano image asset must live in `src/shared/assets/`, not `src/desktop/`

**Symptom:** `import pianoImageUrl from './assets/piano.png'` fails in `KeysPlayerScene3D.ts` because the file is in `src/desktop/assets/`.

**Root cause:** `KeysPlayerScene3D.ts` is a shared file in `src/shared/`. It can't import relative assets from `src/desktop/`.

**Fix:** Copy `piano.png` to `src/shared/assets/piano.png` and import from `'./assets/piano.png'` within the shared module. Vite resolves it correctly from either entry point.

---

## `super-three@0.184.0` is the unified `three` package for both entry points

**Why this matters:** IWSDK's peer dependency is `super-three` (Meta's Three.js fork). Desktop Three.js must be the same module instance, or you get two `THREE` namespaces and mesh registration fails.

**Fix:** `"three": "npm:super-three@0.184.0"` in `package.json`. Both `desktop.html` and `xr.html` bundles resolve `import * as THREE from 'three'` to the same package. Version `0.184.0` exists and is compatible with IWSDK.

---

## Import paths in Combined: no `.js` extensions, `../shared/` prefix

**Symptom:** Module not found errors at dev-server startup.

**Root cause:** XRProto used `.js` extensions on imports (Node16 ESM style). Vite's bundler resolves `.ts` files directly — `.js` suffixes on cross-file imports are not needed and cause resolution failures when the file is `.ts`.

**Fix:** Remove all `.js` extensions from imports. XR-local imports stay `./Foo`, shared imports become `../shared/Foo`.
