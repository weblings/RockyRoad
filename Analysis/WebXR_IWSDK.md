# WebXR / IWSDK Plan

Full planning document for the WebXR experience built on Meta's Immersive Web SDK (IWSDK).

---

## Decided direction

Build the XR version as a fresh IWSDK project. The existing 2D app is preserved as `ThreeCP/v0/` — `ThreeCP/Project/` becomes the IWSDK-based version. Pure logic files (`SongFormat`, `SongPlayer`, `SongIndex`, `PitchDetector`, etc.) carry over with zero cost. The rendering and UI layers are rebuilt around IWSDK.

---

## Session strategy

On app load, run two checks in parallel:

1. `navigator.xr?.isSessionSupported('immersive-vr')` — is XR available at all?
2. Is this a **standalone XR device**? Heuristic: XR is supported AND `!window.matchMedia('(pointer: fine)').matches` (no mouse) AND the UA contains a known standalone identifier (`OculusBrowser`, `Quest`, `VRBrowser`). PC users with a tethered headset have a fine pointer and a normal browser window — they get an **"Enter VR"** button instead of auto-entry.

**Standalone device:** show a minimal fullscreen landing page — one large "Tap to start" button. The browser requirement that `requestSession` must be called inside a user gesture means a single tap is unavoidable, but the experience feels immediate. On tap, `xr.requestSession('immersive-vr')` fires and the app enters XR. The user never sees the 2D app.

**PC + headset:** standard browser window loads normally with an "Enter VR" button in the app UI. Clicking it starts the session.

**No XR:** 2D mode — `ThreeCP/v0/` or IWSDK desktop emulation.

---

## World anchor

A single **world anchor** entity sits in the IWSDK world. Everything the app renders lives as a child of this entity. Moving or rotating the anchor repositions the whole experience in physical space. On session start, the anchor is placed **1 m in front of the user** at eye height, facing them — derived from the initial XR camera pose.

**Recenter** resets the anchor to that default position/orientation relative to the current head pose. Bound to the left controller menu button and a button on the HUD.

---

## Two panels

**Panel A — 3D highway panel**
`FretPlayerScene3D` renders into a `WebGLRenderTarget`. A `PlaneGeometry` mesh (child of the world anchor entity) displays that texture — the highway appears as a large floating screen. Default size ~3 m × 1.5 m. Always tied to the world anchor; the gizmo moves the anchor which moves this panel with it.

**Panel B — 2D UI panel**
The HTML screens (library, pre-scene, tuner) need to be visible in XR. Options, in order of increasing quality:

1. **html2canvas snapshot** — serialize `#screen-container` DOM to a `<canvas>` each frame via `html2canvas`. Apply as a Three.js texture on a plane. Input: XR controller ray → UV coordinate on plane → synthesized `MouseEvent` dispatched to the underlying HTML element. Fast to implement, not pixel-perfect, interaction latency is noticeable.

2. **Custom canvas-rendered screens** — each screen gets a `drawToCanvas(ctx: CanvasRenderingContext2D)` method alongside its existing HTML `mount()`. In XR mode the canvas version is used instead of DOM injection. More work upfront but crisp output and snappy interaction. The tuner canvas is already done this way.

3. **IWSDK uikit** — rebuild screens as spatial UI panels using IWSDK's uikit layout system. Most work, best result long-term.

**Recommendation:** start with option 1 for a proof of concept. Migrate screens to option 2 one at a time as polish is needed.

Panel B is a sibling of Panel A under the world anchor but has its own local transform offset. This lets the user nudge it independently without moving the highway. On recenter, Panel B's local offset resets to a default (centred, same plane as Panel A, or slightly to the left).

When the active scene is entered, Panel B fades out (opacity to 0 over 0.3 s) and Panel A becomes the focus. On exit back to library, Panel B fades back in.

---

## Gizmo

An `XRGizmo` entity attached to the world anchor provides axis-constrained transform handles:
- **Translate handles** — three arrows along X/Y/Z (red/green/blue)
- **Rotate handles** — three rings for pitch/yaw/roll (matching colours)

Handles are `THREE.Mesh` objects, ray-cast tested against both XR controller rays each frame. On `selectstart` over a handle: record controller pose and anchor transform; on controller move, compute the delta and apply constrained offset to the anchor. On `selectend`: finalise.

**Free grab** is also supported — point at either panel (not a handle), hold trigger, move. The panel follows the controller freely. On release it stays where it was.

Panel B has a secondary smaller gizmo (translate only) for its local offset within the anchor.

Gizmos are toggled on/off via a HUD button. Hidden by default.

**`@pmndrs/handle`** — IWSDK's grab system wraps this lower-level library (same team as react-three-fiber/drei). Evaluate it before hand-rolling the constrained drag logic — it may provide one-hand grab, two-hand grab, and distance grab essentially for free within the IWSDK ECS context.

---

## HUD bar

A thin bar along the bottom edge of each panel (small `PlaneGeometry` with canvas texture buttons). Ray-cast interactive.

**Highway panel HUD:** `[▶/⏸]  [seek]  [speed]  [↺ Recenter]  [⊕ Gizmo]  [✕ Exit VR]`
**2D panel HUD:** `[↺ Recenter]  [⊕ Gizmo]  [Reset sub-position]`

---

## Settings panel and countdown in XR

The DOM-based settings overlay and 3-2-1 countdown are invisible inside a headset. In XR:

- The ⚙ button in the highway HUD calls `app.openSettings()` programmatically
- `App.openSettings()` gains an XR path: creates a small floating spatial panel mirroring the settings content
- The scrim becomes a dimming of the highway panel brightness
- `startCountdown()` gains an XR delegate: updates a world-space `THREE.Sprite` with the countdown number alongside the existing DOM update

---

## New files

| File | Responsibility |
|---|---|
| `XRManager.ts` | Session lifecycle, `enterXR()` / `exitXR()`, controller setup, `isActive` getter |
| `XRWorldScene.ts` | IWSDK world setup; owns the world anchor entity and both panels |
| `XRPanel.ts` | One panel instance: render target (or canvas texture), mesh, HUD bar, free grab |
| `XRGizmo.ts` | Translate/rotate handles, ray-cast hit test, constrained drag logic |
| `XRInput.ts` | Controller ray meshes, `selectstart`/`selectend` routing to panels and gizmo |

---

## IWSDK — verdict and known concerns

### Why IWSDK is used (not retrofitted)
IWSDK cannot be layered onto the existing codebase:
1. **World owns the renderer** — `World.create(container)` constructs its own `WebGLRenderer`. No API to pass an existing one.
2. **World owns the render loop** — `world.update(delta, time) → renderer.render(scene, camera)`. Our `App.loop()` must be replaced.
3. **ECS TransformSystem overwrites Object3D positions** — all scene geometry must be registered as ECS entities. The v0 2D app is preserved precisely because of this.

### Migration concerns — validate before committing

**1. FretCamera vs IWSDK player rig** *(high concern — prototype first)*
`FretCamera` drives camera position and orientation every frame (lerped position, fov zoom tracking fret range). In IWSDK, the camera is owned by the XR player rig — in headset mode the camera *is* the headset pose. FretCamera's update logic would need to become an IWSDK system that only runs in desktop emulation mode. In XR the highway sits at a fixed world position and the user's head moves. This is the highest-risk unknown — prototype it before migrating screens.

**2. HTML screens** *(biggest migration cost)*
`SongLibraryScreen`, `PreSceneScreen`, `TunerScreen`, and `ActiveSceneScreen` are all DOM-mounted via `innerHTML`. IWSDK's uikit is a spatial panel system, not DOM injection. Every screen needs rebuilding. The tuner canvas is closest (already `CanvasRenderingContext2D`); the song library is the most complex.

**3. App.ts screen router and persistent overlays**
Settings overlay, countdown, and `#screen-container` screen-swapping are DOM-driven at App level. In IWSDK these become persistent spatial entities. All hooks (`onSongPause`, `onSongRollback`, `onSongResume`, `onSettingsChange`) need rewiring into the system/component model.

**4. QuadBatch frame ordering**
`QuadBatch` calls `begin()` and `flush()` inside `drawQuads()` every frame — rebuilds geometry and uploads to GPU. In IWSDK, frame execution order is controlled by system priority numbers. QuadBatch must be assigned a priority that runs after input systems (negative priorities) and before TransformSystem (priority 1). Likely a one-line fix, but needs verification.

**5. Desktop emulation quality**
IWSDK's desktop mode is a pointer/click emulator for developers testing without a headset — not a polished 2D UI. `ThreeCP/v0/` preserves the existing polished 2D experience for non-XR users.

**6. Vite plugin integration**
IWSDK uses `@iwsdk/vite-plugin-dev` and `@iwsdk/vite-plugin-uikitml`. Our `vite.config.ts` has custom `fs.allow` for DLC song files. Needs merging — low risk, needs a test build.

**7. `erasableSyntaxOnly` compatibility**
Our tsconfig has `erasableSyntaxOnly: true` which forbids TypeScript enums. IWSDK examples import `SessionMode` — need to verify it is exported as a `const` object, not a true enum, and that IWSDK's packages compile cleanly under this constraint.

---

## Prototype phases

Six sequential phases, each with a clear pass/fail criterion. Phases build on each other — stop if any fails and reassess.

The prototype lives in `ThreeCP/XRProto/` — a fresh IWSDK scaffold, not a modification of `Project/` or `v0/`.

---

### Pre-reading: what the examples show

The IWSDK examples (`examples/poke/src/index.ts`, `examples/grab/src/index.ts`) reveal two things that soften earlier concerns:

- **`SessionMode.ImmersiveVR`** is imported from `@iwsdk/core` as a plain value, not a TypeScript `enum` declaration. `erasableSyntaxOnly` should be fine.
- **Direct Three.js position mutations work.** Examples call `logoBanner.position.set(0, 1, 1.8)` after `world.createTransformEntity(logoBanner)`, and `panelEntity.object3D!.position.set(0, 1.5, -1.4)` after entity creation. These render at the correct positions. TransformSystem appears to initialise from the mesh's current values, not overwrite with a default. For our use case (QuadBatch geometry that doesn't move — only the camera moves), this is a non-issue.
- **`world.camera`** is directly accessible and mutable in desktop mode (`camera.position.set(...)` used in every example). FretCamera driving `world.camera` each frame should work.

---

### Phase 0 — Scaffold and build *(validates concerns 6 and 7)*

**Goal:** confirm IWSDK installs, builds, and runs alongside our existing Vite/TS config constraints.

Steps:
- `npm create @iwsdk@latest` in `ThreeCP/XRProto/` — choose VR, TypeScript, grabbing enabled, no locomotion, no physics, no Meta Spatial Editor
- Add `"erasableSyntaxOnly": true` to the generated `tsconfig.json` — verify the build still passes
- Merge our `vite.config.ts` `server.fs.allow` (needed for DLC song files outside the project root) into IWSDK's generated `vite.config.ts` alongside its plugins
- Start the dev server, confirm IWSDK's default desktop emulation view appears in browser

**Pass:** dev server runs, no TypeScript errors, browser shows IWSDK's emulation view.
**Fail signal:** `erasableSyntaxOnly` rejects an IWSDK internal import, or Vite plugin conflicts prevent the build.

**STATUS: ✅ COMPLETE**

Findings:
- `npm create @iwsdk@latest XRProto -- -y --no-locomotion --grabbing --no-physics --no-git --no-install` scaffolds non-interactively — no interactive terminal needed.
- `erasableSyntaxOnly: true` added to tsconfig — zero TypeScript errors. IWSDK exports (`SessionMode` etc.) are all `const` objects, not enum declarations.
- `server.fs.allow` merged cleanly alongside IWSDK's vite plugins (`@iwsdk/vite-plugin-dev`, `@iwsdk/vite-plugin-uikitml`, `vite-plugin-mkcert`). No conflicts.
- mkcert requires a one-time UAC prompt to install its local CA on Windows. Must be accepted for HTTPS to work (WebXR requires a secure origin). `https: true` (Vite self-signed) also works but shows browser warnings.
- `package.json` aliases `"three": "npm:super-three@0.181.0"` — so `import * as THREE from "three"` in our copied files resolves to the same package `@iwsdk/core` uses. No duplicate Three.js instance; the CLAUDE.md warning about importing from `'three'` does not apply in this project.
- IWSDK scaffold generates a headless Chromium browser (Playwright) on first run for its XR emulator — one-time ~100MB download, takes a minute.

---

### Phase 1 — QuadBatch inside IWSDK *(validates concern 4)*

**Goal:** confirm our rendering pipeline works inside IWSDK's frame ordering with no artifacts.

Steps:
- Copy `SongFormat.ts`, `QuadBatch.ts`, `Scene3D.ts`, `ChartScene3D.ts`, `FretPlayerScene3D.ts`, `UIColor.ts`, `UIImage.ts`, `MathUtil.ts`, `NoteUtil.ts` into `XRProto/src/` — these have no App/screen dependencies
- Load a song JSON directly (`fetch('./songs/song.json')`) to get `instrumentNotes`
- Instantiate `FretPlayerScene3D`. Its constructor creates a `THREE.Mesh` internally (via `QuadBatch`)
- Wrap that mesh: `world.createTransformEntity(fretScene.mesh)`
- Register a custom IWSDK system at priority `0` (default game-logic slot):
  ```ts
  class HighwaySystem extends System {
    execute(delta: number) {
      fretScene.currentSecond += delta;
      fretScene.draw(delta);
    }
  }
  world.registerSystem(HighwaySystem);
  ```
- Position the mesh 2m in front of camera initial position

**Pass:** highway geometry renders and scrolls smoothly. No frame-ordering glitches (geometry missing or flickering between frames).
**Fail signal:** QuadBatch `flush()` uploads after `renderer.render()`, causing a one-frame lag or blank frames. Fix: adjust system priority to run earlier, or hook into IWSDK's pre-render callback if one exists.

**STATUS: ✅ COMPLETE**

Findings:
- Highway geometry rendered and scrolled with no frame-ordering glitches. QuadBatch `flush()` (buffer upload only, no render call) integrates cleanly with IWSDK's owned render loop.
- **Key structural changes required to the copied files:**
  - `QuadBatch.draw(renderer, scene, camera)` → `QuadBatch.flush()`: remove the `renderer.render()` call entirely. IWSDK renders the scene; we only need to mark buffers dirty and set the draw range.
  - `Scene3D` must NOT add `quadBatch.mesh` to a private `THREE.Scene`. Expose `get mesh()` and let the IWSDK host register it via `world.createTransformEntity(scene.mesh, { parent: world.sceneEntity, persistent: true })`.
  - `TextBatch` removed for Phase 1 (sprites require scene registration; deferred). `drawText()` stubbed as a no-op on `Scene3D` so `FretPlayerScene3D` call sites compile unchanged.
  - `ChartScene3D` and `FretPlayerScene3D` copied unchanged — no modifications needed.
- **System API:** the plan pseudocode used `execute(delta)` — the real method is `update(delta, time)`.
- **Data loading:** song data loaded via `fetch('/@fs/...')` absolute paths in the `World.create().then(async ...)` callback before registering the system. Song base path hardcoded for the prototype. Three fetches: `song.json` (SongInfo), `arrangement.json` (SongStructure), `lead.json` (SongInstrumentNotes). `ImageManifest.json` copied to `XRProto/public/`.
- **TransformSystem concern resolved:** `mesh.matrixAutoUpdate = false` and `mesh.matrixWorld.identity()` on the QuadBatch mesh are unaffected. IWSDK's TransformSystem initialises from the existing Object3D values and does not fight with a stationary identity-transform mesh.
- **FretCamera** runs each frame inside `FretPlayerScene3D` (via `updateCamera`) but drives its own private `threeCamera`, not `world.camera`. This is harmless in Phase 1 — the camera update just has no visible effect. Phase 2 wires FretCamera's output to `world.camera`.
- **Console noise (all harmless):** AudioContext autoplay warning (no audio in Phase 1), favicon 404, GLSL precision warnings from IWSDK's own internal shaders (not QuadBatch's shader).

---

### Phase 2 — FretCamera in desktop emulation *(validates concern 1, desktop path)*

**Goal:** confirm FretCamera can drive `world.camera` without conflicting with IWSDK's camera management.

Steps:
- Add a `syncCameraTo(target: THREE.PerspectiveCamera): void` method to `FretPlayerScene3D` in `XRProto/src/`:
  ```ts
  syncCameraTo(target: THREE.PerspectiveCamera): void {
    target.position.copy(this.fretCamera.threeCamera.position);
    target.quaternion.copy(this.fretCamera.threeCamera.quaternion);
    target.fov = this.fretCamera.threeCamera.fov;
    target.updateProjectionMatrix();
  }
  ```
- In `HighwaySystem.update()`, after `fretScene.draw(delta)`, call the sync — but only in desktop mode:
  ```ts
  import { VisibilityState } from '@iwsdk/core';

  update(delta: number, _time: number): void {
    const fretScene = this.world.globals.fretScene as FretPlayerScene3D | undefined;
    if (!fretScene) return;
    fretScene.currentSecond += delta;
    fretScene.draw(delta);
    // Only drive world.camera in desktop mode — in XR the headset owns the camera
    if (this.visibilityState.peek() !== VisibilityState.Visible) {
      fretScene.syncCameraTo(this.camera);
    }
  }
  ```
- No separate `FretCameraSystem` needed — camera sync belongs in `HighwaySystem` after `draw()` since `draw()` is what runs `updateCamera()` and populates `fretCamera.threeCamera`
- Verify IWSDK's desktop emulation (mouse look) doesn't fight the camera — if it does, find the flag to disable emulation camera controls

**Pass:** highway renders with the correct angled-down-forward FretCamera perspective in the browser. Camera smoothly tracks the note range.
**Fail signal:** IWSDK's emulation camera overrides FretCamera each frame. Fix: check IWSDK config for a `disableCameraEmulation` option, or use a higher priority for `HighwaySystem`.

**STATUS: ✅ COMPLETE**

Findings:
- `syncCameraTo(this.world.camera as any)` — the `as any` cast is required because `world.camera` is typed against IWSDK's internal Three.js re-export, while `syncCameraTo` accepts `THREE.PerspectiveCamera` from our `'three'` import. At runtime these are the same deduped module; the cast is purely a TypeScript type boundary workaround. No runtime issues.
- IWSDK's desktop emulation camera did **not** fight FretCamera. Camera sync wins without needing priority tuning or a disable flag.
- `VisibilityState` imported from `@iwsdk/core` works correctly with `erasableSyntaxOnly: true` — no issues (it's a compiled enum from a package, not a declaration in our source).
- `this.world.visibilityState.peek()` works as expected in `update()` — no subscription overhead.

**Corrections to the original plan pseudocode (do not follow the original):**
- `execute(delta)` → `update(delta, time)` — the real IWSDK system method name
- `fretCamera.update(delta)` is wrong — `FretCamera.update()` takes `(minFret, maxFret, targetFocusFret, focusY, dt)`. Don't call it directly. `FretPlayerScene3D.draw()` already calls `updateCamera()` which calls `fretCamera.update()` with the correct computed values. Just copy the result afterward.
- `fretCamera.position` / `.quaternion` / `.fov` are wrong sources — `FretCamera.update()` mutates `this.threeCamera` directly (calls `threeCamera.position.set(...)` and `threeCamera.lookAt(...)`). It does NOT update the `Camera3D.position` property. Copy from `fretCamera.threeCamera`, not from `fretCamera`.
- `fretCamera` is `private` in `FretPlayerScene3D` — do not attempt to access it directly. Use `syncCameraTo()` as described above.
- `visibilityState.value` → `visibilityState.peek()` in `update()` — `.value` creates a subscription overhead on every frame; `.peek()` reads without subscribing (per IWSDK CLAUDE.md guidelines for hot paths).
- `VisibilityState` is a compiled enum exported from `@iwsdk/core`. Importing and using it is fine even with `erasableSyntaxOnly: true` — that constraint only blocks enum *declarations* in our own source files, not usage of enums from compiled packages.

---

### Phase 3 — XR session, static highway *(validates concern 1, XR path)*

**Goal:** confirm the highway is visible in a real XR session without FretCamera fighting the headset pose.

Steps:
- On device (or IWSDK's built-in WebXR emulator), enter immersive VR
- `HighwaySystem.update()` already guards with `visibilityState.peek() !== VisibilityState.Visible` — camera sync is a no-op in XR (see Phase 2 corrections)
- Place the highway entity at a fixed world position the headset can see: 1m forward, slightly below eye level, rotated to face the user
- Confirm the highway is visible and the headset can look around it freely

**Pass:** highway renders in headset. No camera conflicts. User can physically look at the scrolling highway from a natural head position.
**Fail signal:** highway is at the wrong scale or position and uncomfortable to view — adjust the world-space transform. Not a fundamental failure, just calibration.

**STATUS: ✅ COMPLETE**

Findings:
- **Local-Z refactor required before XR was visible.** The original geometry used absolute song-time Z coordinates (`z = time * -timeScale`). In XR, the headset stays near world origin but the geometry drifted arbitrarily far in -Z as `currentSecond` advanced — invisible within seconds of page load. Fix: switch to local Z (`z = (time - currentTime) * -timeScale` via `toZ()` helper on `ChartScene3D`), so the now-line is always at Z=0 in mesh-local space. `FretCamera.update()` focusY argument changed from `-(currentTime * timeScale)` to `0` accordingly.
- **`matrixAutoUpdate`**: removed `mesh.matrixAutoUpdate = false` and `mesh.matrixWorld.identity()` from `QuadBatch` — mesh is now a child of the anchor and needs Three.js to propagate parent transforms normally.
- **Anchor entity**: `new Object3D()` (imported from `@iwsdk/core`) at `scale=0.003`, `position=(-0.45, 0.8, -0.5)`. Highway mesh parented under it via `world.createTransformEntity(mesh, { parent: anchorEntity })`. Scale 0.003 maps highway width (~225 units) to ~0.68m in world space.
- **Desktop camera restored** via `syncCameraTo(world.camera, anchor)` — FretCamera's local-space position mapped through `anchor.matrixWorld` each frame. `anchor.updateMatrixWorld()` called manually before the sync since IWSDK's TransformSystem may not have run at our system priority. Guard: `visibilityState.peek() !== VisibilityState.Visible` — XR path unaffected.
- **Bug found and fixed in both ThreeCP/Project and XRProto**: vertical connector line (`drawFretVerticalLine`) had no guard, drawing a white stub at Z=0 for all finished notes still in the 1-second lookback window. Fixed by wrapping with `if (!isCurrent || drawCurrent)` to match the note head guard.

---

### Phase 4 — Audio sync *(validates SongPlayer coexistence)*

**Goal:** confirm `SongPlayer` (which creates its own `AudioContext`) coexists with IWSDK's audio system without conflict.

Steps:
- Copy `SongPlayer.ts` from `ThreeCP/Project/src/` into `XRProto/src/` — it has no App/screen dependencies
- Load the `.ogg` via `SongPlayer.loadSong(url)` using the same `/@fs/` path pattern as the song JSON files
- Start playback on first user gesture (required by browser AudioContext policy — we already saw the autoplay warning in Phase 1). In IWSDK, wire this to a controller button press detected in `HighwaySystem.update()` via `this.input.gamepads.right?.getButtonDown(InputComponent.Trigger)`, or add a `PokeInteractable` play button entity
- Drive `fretScene.currentSecond` from `songPlayer.currentSecond` instead of accumulated delta
- For testing, use the existing `skipIntro` flag (from `Settings.ts` — seek to `instrumentNotes.Notes[0].TimeOffset` at load when enabled). Copy `Settings.ts` unchanged; don't hardcode the seek or alter the general song logic
- Verify audio plays and highway scrolls in sync

**Pass:** audio plays, highway scrolls in sync, no `AudioContext` errors or conflicts with IWSDK's `AudioSource` component system.
**Fail signal:** two `AudioContext` instances in the same page cause issues. Fix: check if IWSDK exposes its `AudioContext` for reuse, or verify browser allows two concurrent contexts (it does in most cases — this is the low-risk concern).

**STATUS: ✅ COMPLETE**

Findings:
- **No AudioContext conflict**: `SongPlayer` creates its own `AudioContext` alongside IWSDK's — no errors, no interference. Two concurrent contexts work fine in Chrome/Edge.
- **`SongPlayer.ts` copied unchanged** — zero App/screen dependencies confirmed. Dropped into `XRProto/src/` with no modifications.
- **Parallel load**: `songPlayer.loadSong()` added to the existing `Promise.all()` alongside JSON/manifest fetches — audio ready at the same time as song data.
- **Skip intro**: `seekTo(instrumentNotes.Notes[0].TimeOffset)` called after load. `fretScene.currentSecond` initialised to match before the system loop starts.
- **XR input**: `this.input.gamepads.right?.getButtonDown(InputComponent.Trigger)` in `HighwaySystem.update()` — right trigger toggles play/pause. `InputComponent` imported from `@iwsdk/core`. No additional system or component needed.
- **Desktop input**: `document.addEventListener('keydown', ...)` for Space bar — satisfies AudioContext user-gesture requirement without any IWSDK-specific API.
- **Timing driver**: `fretScene.currentSecond = songPlayer.currentSecond` replaces the `+= delta` accumulator. Highway visuals are now slaved to the AudioContext clock, so they stay locked to audio across frame-rate variation.

---

### Phase 5 — Free grab on the highway *(validates `@pmndrs/handle` / IWSDK grab)*

**Goal:** confirm the highway panel is grabbable and repositionable using IWSDK's built-in grab system.

Steps:
- The QuadBatch mesh has `matrixAutoUpdate = false` and `matrixWorld.identity()` — IWSDK's TransformSystem can update `object3D.position` but the matrixWorld won't recompute, so the mesh won't visually move if grabbed directly. **The parent-entity wrapper is required, not a fallback.** Create it upfront:
  ```ts
  const anchorMesh = new THREE.Object3D();
  const anchorEntity = world.createTransformEntity(anchorMesh, { parent: world.sceneEntity, persistent: true });
  world.createTransformEntity(fretScene.mesh, { parent: anchorEntity, persistent: true });
  ```
- Add grab components to `anchorEntity`, not to the mesh entity:
  ```ts
  anchorEntity
    .addComponent(Interactable)
    .addComponent(OneHandGrabbable);
  ```
  Note: verify `OneHandGrabbable` schema against IWSDK source before passing options — the `{ translate: true, rotate: true }` options in the original plan are unverified
- Test in desktop emulation (mouse drag) and on device (controller trigger + move)
- Confirm the highway can be freely repositioned and stays where released

**Pass:** highway grabs and repositions naturally. Releasing it holds position.
**Fail signal:** grab still doesn't move the visual highway — QuadBatch geometry is in world space and the anchor transform isn't being applied. May need to abandon `matrixAutoUpdate = false` on the mesh and let Three.js recompute matrixWorld from the parent chain each frame.

**STATUS: ✅ COMPLETE**

Findings:
- **`Interactable` is deprecated** — replaced by `RayInteractable` (for ray/pointer interaction) and `PokeInteractable` (for touch). `OneHandGrabbable` uses `RayInteractable`, not the old `Interactable`.
- **`OneHandGrabbable` takes `{}`** — no required schema options. `{ translate, rotate }` options from original plan were unverified and unnecessary for default free-grab behavior.
- **Real device (Quest Link) requires `V` key to launch XR** — IWER's overlay provides the "Enter XR" button; without IWER the button disappears. Added `V` keydown → `world.launchXR()` as a device-mode trigger.
- **IWER disable: use `--mode device` not env var** — `vite.config.ts` switched to `defineConfig(({ mode }) => ...)` pattern; `npm run dev:device` passes `--mode device`, skipping the `iwsdkDev` plugin entirely. `cross-env IWER=false` did not propagate reliably.
- **Grab works on real hardware** — anchor entity with `RayInteractable` + `OneHandGrabbable`, highway mesh parented under it. Controller squeeze grabs and repositions the highway freely; position holds on release.

---

### Phase 6 — html2canvas UI panel *(validates concern 2, option 1)*

**Goal:** confirm a DOM HTML screen can be projected onto an XR plane and receive controller input.

**STATUS: ✅ COMPLETE**

Findings:
- **`html2canvas` → `CanvasTexture` pipeline works** — DOM div rendered off-screen (`position:fixed; left:-9999px`), html2canvas renders it to a canvas each 100ms, drawn into a `CanvasTexture` backing a `PlaneGeometry` entity. `panelTex.needsUpdate = true` required after each draw.
- **`RayInteractable` required for ray cursor** — without it, the controller ray renders but the cursor doesn't snap to the panel surface. Adding it to the panel entity makes the ray visually respond.
- **Manual `Raycaster` for UV** — IWSDK's `InputSystem` doesn't expose intersection UV via the `Pressed` component. Manual `Raycaster.intersectObject(panelMesh)` after calling `ray.updateMatrixWorld()` + `panelMesh.updateMatrixWorld()` gives the UV. Ray direction: `(0,0,-1).transformDirection(raySpace.matrixWorld)`.
- **Button hit-test via `getBoundingClientRect()`** — buttons are off-screen but their rects are still valid. `btn.getBoundingClientRect()` minus `panelDiv.getBoundingClientRect()` gives panel-local pixel coords. Compare against UV-mapped pixel position to find which button was hit, then call `onClick()` directly.
- **Both hands needed** — loop over `[gamepads.left, gamepads.right]` with their respective `raySpaces`; either trigger fires the panel. Hardcoding right-only was an oversight.
- **`IWER=false` / device mode** — use `npm run dev:device` (`--mode device`) to skip IWER plugin entirely. Press `V` on keyboard to call `world.launchXR()` since IWER's Enter XR button is absent.

Steps:
- Install `html2canvas`: `npm install html2canvas` — it is not in the scaffold dependencies
- Mount a simplified `SongLibraryScreen`-like DOM element into a hidden off-screen `<div>`
- Each frame (throttled to ~10fps — no need to match 90fps): `html2canvas(div)` → `CanvasTexture` → update a `PlaneGeometry` entity's material map
- For ray → UV → click: `RayInteractable` gives hover/press state tags but does not expose the UV of the hit point directly. Options:
  1. Query IWSDK's input system or xr-input package to see if the ray intersection point is accessible on the entity or from `this.input`
  2. Fall back to a manual `THREE.Raycaster` against the plane mesh to get the intersection UV (the IWSDK reviewer agent flags this, but it's acceptable for a prototype plane with no BVH needed)
- Map intersection UV → pixel coordinates on the div → synthesize and dispatch a `MouseEvent` at that point
- Verify a button click on the panel triggers the underlying DOM handler

**Pass:** HTML screen is visible in XR, buttons respond to controller ray. Interaction latency is acceptable for navigation (not great for typing, but fine for song selection).
**Fail signal:** `html2canvas` performance is too poor at 10fps to feel usable. Fallback: drop to on-demand snapshot (only re-render when DOM content changes) — test that variant.

---

### After Phase 6

If all phases pass, the migration is de-risked. Begin porting screens one at a time into the `XRProto/` world, starting with `PreSceneScreen` (simplest HTML, least state) and ending with `SongLibraryScreen` (most complex). The `App.ts` screen router becomes an IWSDK system with a `currentScreen` signal.

---

## Future: immersive mode

Once the panel model is working, a second mode: XR cameras replace the panel metaphor entirely and the player stands inside the highway at real scale. Notes scroll toward them at 1:1 size. Toggle in the HUD, not a separate flow.

---

## Piano positioning + spatial anchors

In XR mode, let the user position the keyboard instrument in physical space using spatial anchors (WebXR Anchors API). The piano would sit at a fixed real-world location across sessions. Requires 6DOF tracking (Quest 3, etc.).

With the panel model established, the keys scene is Panel A for keyboard songs — same anchor and gizmo infrastructure. Spatial anchors persist the anchor's world transform between sessions.
