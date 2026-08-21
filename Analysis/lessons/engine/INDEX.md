# Engine lessons — index

IWSDK/Three.js/Web Audio API facts, this project's own XR/3D rendering internals, and dev/debug
environment technique. Filed by activity/task-type. Check the file(s) matching what you're about
to do before touching XR scene graph, input, rendering internals, or build/dev setup.

- [`runtime-apis.md`](runtime-apis.md) — third-party API facts that constrain how code must be
  written: `OneHandGrabbable`/`RayInteractable`, `getWorldDirection()`'s +Z convention,
  `THREE.Sprite` crashing IWSDK's pointer system, `Entity.dispose()`/`createTransformEntity`
  scene-graph facts, `visual.model.visible` reset-every-frame, Web Audio objects needing an
  explicit stop, IWSDK owning the XR render loop (`QuadBatch.flush()` vs `draw()`), `super-three`
  version pinning (0.184.0 breaks CanvasTextures in multiview), `CanvasTexture`'s `NoColorSpace`
  default washing out dark colors.
- [`xr-3d-rendering.md`](xr-3d-rendering.md) — this project's own coordinate/rendering internals:
  the local-Z refactor, audio-less charts freezing the highway, `getFretPosition()`'s
  non-linearity, `QuadBatch`'s known buffer-upload inefficiency, `Scene3D.xrMode` construction
  ordering, why resizing a canvas backing a live `CanvasTexture` at runtime is unreliable, XR's
  fixed-volume culling turning camera-convergence lag into missing notes, why a flat "ground decal"
  quad is nearly invisible near-parallel to the camera with XR having no background to fall back on,
  why an isolated single-object raycast is occlusion-blind compared to the real scene-aware pointer
  system, continuous damping vs. discrete tweens for a moving-target billboard.
- [`dev-environment.md`](dev-environment.md) — Windows/Vite/TypeScript build setup: `/@fs/`
  cross-drive failures, IWER's missing device-mode button, debugging the JS console from a Quest
  (in-scene `DEBUG_CONSOLE_ENABLED` panel preferred over unreliable chrome://inspect),
  logging `Error` objects correctly, `verbatimModuleSyntax`/`noUnusedLocals` gotchas, two-entry
  Vite builds, dev-proxying a plain-HTTP server, import-path conventions.
- [`web-audio-worklets.md`](web-audio-worklets.md) — adopting an AudioWorklet-based library
  (pitch-preserving speed via `@soundtouchjs/audio-worklet`): Vite's `?url` + package subpath
  exports serving a worklet file with no manual copy step, verifying a third-party audio
  library's actual API before designing around assumed prior knowledge, why a worklet node's
  internal DSP state goes stale on any fresh upstream source (not just explicit seeks),
  AudioParams resetting to default on (re)construction, disconnecting outgoing nodes explicitly,
  using a worklet's own health-metrics API to tell buffer underrun apart from an algorithmic
  quality ceiling.

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
