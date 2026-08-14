# Engine lessons — index

IWSDK/Three.js/Web Audio API facts, this project's own XR/3D rendering internals, and dev/debug
environment technique. Filed by activity/task-type. Check the file(s) matching what you're about
to do before touching XR scene graph, input, rendering internals, or build/dev setup.

- [`runtime-apis.md`](runtime-apis.md) — third-party API facts that constrain how code must be
  written: `OneHandGrabbable`/`RayInteractable`, `getWorldDirection()`'s +Z convention,
  `THREE.Sprite` crashing IWSDK's pointer system, `Entity.dispose()`/`createTransformEntity`
  scene-graph facts, `visual.model.visible` reset-every-frame, Web Audio objects needing an
  explicit stop.
- [`xr-3d-rendering.md`](xr-3d-rendering.md) — this project's own coordinate/rendering internals:
  the local-Z refactor, audio-less charts freezing the highway, `getFretPosition()`'s
  non-linearity, `QuadBatch`'s known buffer-upload inefficiency.
- [`dev-environment.md`](dev-environment.md) — Windows/Vite/debugging setup: `/@fs/` cross-drive
  failures, IWER's missing device-mode button, remote-debugging a Quest from PC, logging `Error`
  objects correctly.

## Cross-listed (touches more than one topic)

- **`THREE.Sprite` crashes IWSDK's pointer system** (`runtime-apis.md`) — the symptom (frame-rate
  crater) looks like an `xr-3d-rendering.md` performance issue; filed under `runtime-apis.md`
  because the fix is IWSDK-API-shaped (no-op `raycast()`), not a rendering-internals change.
- **Console errors needing `Error`-object special-casing** (`dev-environment.md`) was originally
  found while debugging a `uikit` panel-load error, but the lesson itself is general logging
  hygiene, not uikit-specific — see `ui-toolkit/INDEX.md` for the uikit side of that story.
