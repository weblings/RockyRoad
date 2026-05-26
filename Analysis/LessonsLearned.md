# Lessons Learned

Gotchas, non-obvious findings, and hard-won decisions that aren't obvious from reading the code or planning docs. Add here whenever something costs more than 30 minutes to diagnose.

---

## XRProto: `/@fs/` cross-drive paths fail on Windows

**Symptom:** `fetch('/@fs/C:/...')` returns HTTP 200 with `text/html` (Vite's SPA fallback) instead of the actual file. The JSON parse fails with `Unexpected token '<'`.

**Root cause:** Vite's `/@fs/` handler breaks when the project is on one drive (e.g. `D:`) and the target file is on a different drive (e.g. `C:`). Path resolution strips the leading `/` and gets confused across drive letters. Adding the path to `server.fs.allow` does not fix it.

**Fix:** Copy test song files into `XRProto/public/songs/<song-name>/` and use a plain `/songs/<song-name>/` URL. No `/@fs/` needed.

**When `/@fs/` is appropriate:** Referencing files outside the project root on the **same drive** — e.g. the DLC song library on `D:` from a project also on `D:`. Once the full song library browser is wired up, songs will be read from their real location; that path should stay on the same drive or be served through a dedicated mechanism.

---

## XRProto: local-Z refactor required before XR is visible

**Symptom:** Highway geometry disappears within seconds of entering XR. No errors.

**Root cause:** Geometry was using absolute song-time Z coordinates (`z = time * -timeScale`). In XR the mesh is parented under a scaled anchor near the world origin. As `currentSecond` advances, the geometry drifts arbitrarily far in −Z — out of the visible frustum almost immediately.

**Fix:** Switch to local Z: `z = (time - currentTime) * -timeScale` so the now-line is always at Z=0 in mesh-local space. A `toZ(songTime)` helper on `ChartScene3D` encapsulates this. **Both `FretPlayerScene3D` and `KeysPlayerScene3D` require this refactor before they work in XR.**

---

## IWSDK: `OneHandGrabbable` uses squeeze, not trigger

**Symptom:** Grab doesn't activate when holding the trigger over an object.

**Root cause:** `OneHandGrabbable` (proximity-based grab) is activated by the **squeeze** button. The trigger is the ray-select button used by `RayInteractable`.

**Fix:** Use squeeze to grab. Update any UX copy that says "hold trigger to grab."

---

## IWSDK: `Interactable` is deprecated

**Symptom:** Adding `Interactable` to an entity produces no ray cursor response.

**Root cause:** `Interactable` was replaced by `RayInteractable` (ray/pointer) and `PokeInteractable` (touch). `OneHandGrabbable` requires `RayInteractable`, not the old component.

**Fix:** Use `RayInteractable` for any entity that should respond to controller rays.

---

## IWSDK device mode: IWER "Enter XR" button is absent

**Symptom:** Running `npm run dev:device` (real hardware mode) — no "Enter XR" button appears in the browser.

**Root cause:** `--mode device` skips the `iwsdkDev` Vite plugin entirely, so IWER's overlay isn't injected.

**Fix:** Add a `V` keydown handler calling `world.launchXR()` as a keyboard shortcut for device mode. Already wired in `XRProto/src/index.ts`.

---

## XRProto: Charts without `song.ogg` freeze the highway

**Symptom:** Notes render but don't move regardless of pressing play.

**Root cause:** Some charts ship JSON-only with no audio file. `SongPlayer` requires a decoded audio buffer before `play()` does anything, so time never advances.

**Fix:** `SongPlayer.play()` now works as a pure timer even with no audio — it creates an `AudioContext` for timekeeping whether or not a buffer was loaded. Audio playback is conditional on the buffer existing. Charts without `.ogg` now scroll correctly.
