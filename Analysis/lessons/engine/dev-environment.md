# Engine — dev environment and debugging setup

Windows/dev-server/debugging technique, independent of any particular screen or API. See
[`INDEX.md`](INDEX.md) for the full engine map.

---

## XRProto: `/@fs/` cross-drive paths fail on Windows

**Symptom:** `fetch('/@fs/C:/...')` returns HTTP 200 with `text/html` (Vite's SPA fallback) instead of the actual file. The JSON parse fails with `Unexpected token '<'`.

**Root cause:** Vite's `/@fs/` handler breaks when the project is on one drive (e.g. `D:`) and the target file is on a different drive (e.g. `C:`). Path resolution strips the leading `/` and gets confused across drive letters. Adding the path to `server.fs.allow` does not fix it.

**Fix:** Copy test song files into `XRProto/public/songs/<song-name>/` and use a plain `/songs/<song-name>/` URL. No `/@fs/` needed.

**When `/@fs/` is appropriate:** Referencing files outside the project root on the **same drive** — e.g. the DLC song library on `D:` from a project also on `D:`. Once the full song library browser is wired up, songs will be read from their real location; that path should stay on the same drive or be served through a dedicated mechanism.

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

**Fallback when USB/chrome://inspect isn't cooperating:** a plain `CanvasTexture` plane in the
scene, positioned at a fixed world location, with `console.log`/`warn`/`error` and
`window.onerror`/`unhandledrejection` monkey-patched to also draw each line onto it. Zero
external dependency, works regardless of remote-debugging state. Used successfully in the
uikit migration session to find a runtime error that USB debugging couldn't surface reliably.

---

## Console errors need special-casing for `Error` objects, or the real reason gets swallowed

**Symptom:** The `CanvasTexture` fallback console above showed `[PanelUISystem] Error loading panel for entity 9: {}` — the actual error message was gone, just empty braces.

**Root cause:** `console.error('...', someError)` passes the `Error` object as a second arg.
`JSON.stringify(error)` on a plain `Error` produces `"{}"` — `message`/`stack` aren't enumerable
own properties, so they're dropped.

**Fix:** Any custom console-mirroring/logging code needs an explicit case for `instanceof Error`
(e.g. `` `${err.name}: ${err.message}` ``) before falling back to `JSON.stringify`.
