# Engine — this project's XR/3D rendering internals

Facts specific to this project's own scene/coordinate/rendering code (not third-party API
surface). See [`INDEX.md`](INDEX.md) for the full engine map.

---

## XRProto: local-Z refactor required before XR is visible

**Symptom:** Highway geometry disappears within seconds of entering XR. No errors.

**Root cause:** Geometry was using absolute song-time Z coordinates (`z = time * -timeScale`). In XR the mesh is parented under a scaled anchor near the world origin. As `currentSecond` advances, the geometry drifts arbitrarily far in −Z — out of the visible frustum almost immediately.

**Fix:** Switch to local Z: `z = (time - currentTime) * -timeScale` so the now-line is always at Z=0 in mesh-local space. A `toZ(songTime)` helper on `ChartScene3D` encapsulates this. **Both `FretPlayerScene3D` and `KeysPlayerScene3D` require this refactor before they work in XR.**

---

## XRProto: Charts without `song.ogg` freeze the highway

**Symptom:** Notes render but don't move regardless of pressing play.

**Root cause:** Some charts ship JSON-only with no audio file. `SongPlayer` requires a decoded audio buffer before `play()` does anything, so time never advances.

**Fix:** `SongPlayer.play()` now works as a pure timer even with no audio — it creates an `AudioContext` for timekeeping whether or not a buffer was loaded. Audio playback is conditional on the buffer existing. Charts without `.ogg` now scroll correctly.

---

## FretPlayerScene3D: `getFretPosition()` is non-linear — don't reason about it in "N frets"

**Symptom:** An XR culling window sized as `getFretPosition(9)` (intended: "~9 frets of half-width") turned out to be wider than the *entire* 24-fret neck, silently making the culling a no-op.

**Root cause:** Fret spacing is equal-tempered — `getFretPosition(fret) = 300 * (1 - 2^(-fret/12))` — and compresses logarithmically toward the body. `getFretPosition(9) ≈ 121.6` while `getFretPosition(24) = 225` (the full neck); the "9-fret" value alone is already more than half the total span.

**Fix:** When sizing anything in fret-position units, sanity-check the number against `getFretPosition(24) = 225` (the full neck span) rather than assuming it scales linearly with fret count.

---

## QuadBatch re-uploads its full buffer capacity every frame (known, not yet fixed)

**Symptom:** Suspected but unconfirmed contributor to frame dips in both Keys and Guitar highways.

**Root cause:** `QuadBatch.flush()` sets `needsUpdate = true` on the position/color/uv `BufferAttribute`s with no `addUpdateRange()` call. On the installed Three.js (0.181.0), a blanket `needsUpdate = true` uploads the *entire* attribute array, not just the actively-used portion — so every frame re-uploads all 43,688 quads' worth of buffer (~6MB across position/color/uv) regardless of how many quads (`numQuads`) are actually in use this frame. `setDrawRange` already correctly limits what's *rendered*; it does nothing for what's *uploaded*.

**Fix (not yet applied):** Call `positionAttr.addUpdateRange(0, numQuads * 3)` (and the equivalent for color/uv) before setting `needsUpdate = true`, so only the used portion re-uploads. Worth doing before chasing further XR performance work — likely a bigger win than anything draw-call-count related.

---

## Resizing a canvas backing a live `CanvasTexture` at runtime is unreliable — build fixed presets instead

**Symptom:** A world-space label `Sprite` whose canvas was resized-to-fit on every text change (to
avoid clipping long strings) would stop visually updating after the first draw — computed text was
correct (logged), no exception thrown, `tex.needsUpdate = true` was set, yet the old bitmap stayed
on screen.

**Root cause:** Not conclusively pinned down. Two targeted fixes were tried and neither resolved
it: (1) Chromium-based browsers can skip the implicit clear/context-reset that `canvas.width = x`
normally triggers when `x` equals the current width — added an explicit `clearRect()`, no change;
(2) changing a texture's base pixel dimensions after creation is a known rough edge for WebGL
mipmap regeneration, more so on mobile GPUs — disabled `generateMipmaps`/set `minFilter =
LinearFilter`, no change. The actual fix was structural, not a patch: stop resizing at runtime.

**Fix:** When a canvas-backed texture's content is one of a small, known set of possibilities
(e.g. a handful of instruction strings), render each to its own fixed-size canvas/texture **once**
at startup and swap which texture the material's `.map` points at, rather than mutating one
shared canvas's dimensions and redrawing it live. Never resized after creation, this class of bug
can't happen at all.

---

## XR's fixed-volume culling turns a cosmetic camera-convergence lag into actually-missing notes

**Symptom:** A song opening far up the neck (`HandFret` ~10-12) rendered no notes or fret numbers
for the first several seconds in XR, catching up gradually. Identical song played correctly from
the start on desktop.

**Root cause:** `FretPlayerScene3D.inVolumeFret()` culls anything outside a fixed AR volume window
in XR, but is unconditionally `true` on desktop (`if (!Scene3D.xrMode) return true;` — desktop
relies on the camera frustum instead). `FretCamera.positionFret` starts at a hardcoded default (`3`)
and only lerps toward the real target over time; on desktop that lag is just a cosmetic pan, but in
XR any note outside the still-converging volume during that lag is never drawn at all.

**Fix:** Added `FretCamera.snapToFret()`, called once from `FretPlayerScene3D`'s constructor with
the first note's `HandFret`, so the position starts correct instead of lerping there from a
one-size-fits-all default.

---

## A flat "ground decal" quad is nearly invisible near-parallel to the camera — and XR has nothing behind it to fall back on

**Symptom:** String-color fretboard lines and highway lane lines read as extremely thin/low-contrast
in XR, much more so than on desktop.

**Root cause:** These lines are quads lying flat in the XZ plane (`heightOffset` constant across all
4 vertices) — effectively decals painted on the fretboard surface. The camera's view direction is
dominated by -Z with only a shallow pitch (desktop: ~15°), so a flat decal's on-screen height is
proportional to `thickness × sin(pitch)` — small by construction, and literally zero at a true
head-on view. XR (`SessionMode.ImmersiveAR`) also has no scrim or background of any kind behind the
highway, unlike desktop's opaque canvas, so there's nothing to give these elements contrast even
when some sliver of them is visible.

**Fix:** Gave the string-color lines a companion quad standing upright at a constant Z — the same
orientation already used by the correctly-visible `drawFretVerticalLine` fret dividers, just running
along X instead of Y. Elements whose *length* runs along Z (sustain trails, slides) hit the same
problem from a harder angle — a single companion wall doesn't fix a truly head-on view for those,
since the length axis itself is the near-parallel one; that needs real cross-sectional extrusion or
camera-facing billboarding, not yet done.

---

## `Scene3D.xrMode = true` must be set before any scene construction

**Symptom:** XR scenes create an owned `THREE.Scene`, add the QuadBatch mesh to it, then fail when IWSDK tries to register the same mesh — or the mesh renders twice.

**Root cause:** `Scene3D.xrMode` is a static flag checked in the constructor. Any code path that constructs a `Scene3D` subclass before the flag is set will create a `THREE.Scene` and add the mesh to it.

**Fix:** Set `Scene3D.xrMode = true` at the very top of `src/xr/index.ts`, before any other imports that could transitively construct a scene. It's the first executable line in the XR entry point.
