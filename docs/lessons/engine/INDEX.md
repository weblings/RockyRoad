# Engine lessons — index

IWSDK/Three.js/Web Audio API facts, this project's own XR/3D rendering internals, and dev/debug
environment technique. Filed by activity/task-type. Check the file(s) matching what you're about
to do before touching XR scene graph, input, rendering internals, or build/dev setup.

| File | Scope | Entries | File here when |
|---|---|---|---|
| [runtime-apis.md](runtime-apis.md) | third-party API facts: `OneHandGrabbable`/`RayInteractable`, `getWorldDirection()`'s +Z, `THREE.Sprite` crashing IWSDK's pointer system, `Entity.dispose()`/`createTransformEntity`, `visual.model.visible` reset-every-frame, Web Audio explicit stop, IWSDK owning the render loop, `super-three` pinning, `CanvasTexture`'s `NoColorSpace` | 12 | an IWSDK/Three.js/Web Audio API fact, not our design |
| [xr-3d-rendering.md](xr-3d-rendering.md) | this project's own coordinate/rendering internals: local-Z, audio-less charts, `getFretPosition()` non-linearity, `QuadBatch` upload cost, `Scene3D.xrMode` ordering, canvas-texture resizing, fixed-volume culling, ground decals, occlusion-blind raycasts, damping vs. tweens, reveal-after-transform | 11 | our own scene/coordinate/rendering technique |
| [dev-environment.md](dev-environment.md) | Windows/Vite/TypeScript build setup: `/@fs/` cross-drive, IWER device mode, Quest console debugging, logging `Error`s, `verbatimModuleSyntax`/`noUnusedLocals`, two-entry Vite builds, dev proxy, import paths, `base: "./"` vs. runtime paths | 12 | build, dev-server, deploy, or debugging setup |
| [web-audio-worklets.md](web-audio-worklets.md) | AudioWorklet adoption (`@soundtouchjs/audio-worklet`): `?url` worklet serving, verifying a library's real API, stale DSP state on fresh sources, AudioParam reset, explicit disconnect, underrun metrics vs. quality ceiling, edge-detecting cumulative counters | 7 | AudioWorklet/audio-graph specific |

Counts as of 2026-10-08 — bump when adding entries.

## Cross-listed (touches more than one topic)

- **`THREE.Sprite` crashes IWSDK's pointer system** (`runtime-apis.md`) — the symptom (frame-rate
  crater) looks like an `xr-3d-rendering.md` performance issue; filed under `runtime-apis.md`
  because the fix is IWSDK-API-shaped (no-op `raycast()`), not a rendering-internals change.
- **Console errors needing `Error`-object special-casing** (`dev-environment.md`) was originally
  found while debugging a `uikit` panel-load error, but the lesson itself is general logging
  hygiene, not uikit-specific — see `ui-toolkit/INDEX.md` for the uikit side of that story.
- **Explicit node cleanup on replacement** — `runtime-apis.md`'s "A discarded Web Audio object
  keeps playing unless explicitly stopped" (`AudioBufferSourceNode`) and
  `web-audio-worklets.md`'s "Reassigning a node reference doesn't disconnect the old node from the
  graph" (`AudioWorkletNode`) are the same underlying fact — dropping a JS reference never tears
  down a Web Audio graph connection — hit twice on two different node types.
