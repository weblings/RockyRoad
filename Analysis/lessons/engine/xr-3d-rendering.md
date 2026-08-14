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
