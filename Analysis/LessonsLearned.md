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

## Debugging JS console from Quest Browser on PC

**Problem:** `console.log` output from a WebXR app running in Meta Quest Browser is not accessible — no DevTools on-device and the Quest can't inspect itself.

**Solution:** Connect the Quest via USB with ADB enabled (Settings → Developer Mode), then:

```powershell
# 1. Forward the Chrome DevTools port
& "<path-to-adb>" forward tcp:9222 localabstract:chrome_devtools_remote

# 2. Open in Chrome on PC
chrome://inspect
```

The app tab appears in the list. Click **inspect** for full DevTools — console, network, breakpoints. Works with Meta Quest Browser (Chromium-based).

**ADB path on this machine (Andrew's PC):**
`C:\Program Files\Unity\Hub\Editor\6000.0.30f1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe`

**Note:** `adb logcat -s chromium` shows XR session lifecycle events but NOT `console.log` output from JS. Use `chrome://inspect` instead.

---

## XR / DOM: `+` in element IDs crashes `querySelector`

**Symptom:** `Uncaught SyntaxError: Failed to execute 'querySelector' on 'Element': '#ft-px+' is not a valid selector.` Error appears at runtime in XR (no build-time warning).

**Root cause:** `+` is the CSS adjacent-sibling combinator, so it is illegal inside an ID selector string passed to `querySelector`. TypeScript and Vite do not catch this; it only blows up when the selector is evaluated.

**Fix:** Use alphabetic suffixes instead of operator characters in element IDs. Convention used here: `m` = minus, `p` = plus (e.g. `ft-pxm` / `ft-pxp`). Applies to any character that has CSS selector meaning: `+`, `~`, `>`, `.`, `[`, `:`, etc.

---

## XRProto: Charts without `song.ogg` freeze the highway

**Symptom:** Notes render but don't move regardless of pressing play.

**Root cause:** Some charts ship JSON-only with no audio file. `SongPlayer` requires a decoded audio buffer before `play()` does anything, so time never advances.

**Fix:** `SongPlayer.play()` now works as a pure timer even with no audio — it creates an `AudioContext` for timekeeping whether or not a buffer was loaded. Audio playback is conditional on the buffer existing. Charts without `.ogg` now scroll correctly.
