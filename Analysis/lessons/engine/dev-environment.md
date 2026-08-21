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

**Preferred solution — in-scene debug console:** flip `DEBUG_CONSOLE_ENABLED` to `true` near the
top of `v2/src/xr/index.ts`. This monkey-patches `console.log`/`warn`/`error` and
`window.onerror`/`unhandledrejection` to also draw each line onto a `CanvasTexture` plane in the
scene, readable directly in-headset. No USB/ADB, no external dependency, works every time. Flip it
back to `false` when done — it's off by default.

**Alternative — chrome://inspect, often unreliable:** connect the Quest via USB with ADB enabled
(Settings → Developer Mode), then:

```powershell
# 1. Forward the Chrome DevTools port
& "<path-to-adb>" forward tcp:9222 localabstract:chrome_devtools_remote

# 2. Open in Chrome on PC
chrome://inspect
```

The app tab appears in the list. Click **inspect** for full DevTools — console, network,
breakpoints. Has repeatedly proven unreliable in this project (hence the in-scene console above
being built and preferred) — try it only if the in-scene console itself isn't an option.

**ADB path on this machine (Andrew's PC):**
`C:\Program Files\Unity\Hub\Editor\6000.0.30f1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe`

**Note:** `adb logcat -s chromium` shows XR session lifecycle events but NOT `console.log` output from JS.

---

## Console errors need special-casing for `Error` objects, or the real reason gets swallowed

**Symptom:** The `CanvasTexture` fallback console above showed `[PanelUISystem] Error loading panel for entity 9: {}` — the actual error message was gone, just empty braces.

**Root cause:** `console.error('...', someError)` passes the `Error` object as a second arg.
`JSON.stringify(error)` on a plain `Error` produces `"{}"` — `message`/`stack` aren't enumerable
own properties, so they're dropped.

**Fix:** Any custom console-mirroring/logging code needs an explicit case for `instanceof Error`
(e.g. `` `${err.name}: ${err.message}` ``) before falling back to `JSON.stringify`.

---

## `verbatimModuleSyntax` requires `import type` for every type-only import

**Symptom:** `error TS1484: 'AssetManifest' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.`

**Root cause:** `verbatimModuleSyntax` requires that any symbol used only as a type in the current file be imported with `import type` or `import { type X }`. Importing it as a value triggers an error even if it happens to be erased at runtime.

**Fix:** Use `import { type AssetManifest, ... }` (inline `type` keyword per symbol) or `import type { ... }` for the whole import. Watch for this any time you import an interface or type alias from a module that also exports values.

---

## `_` prefix does not suppress `noUnusedLocals` for private class members

**Symptom:** `error TS6133: '_connectOpen' is declared but its value is never read.` — renaming a private field or method to `_foo` still triggers the error.

**Root cause:** TypeScript's `noUnusedLocals` only treats the underscore prefix as a suppression signal for **function parameters** (e.g. `(_unused: string) => {}`). For private class fields and private methods, the prefix is ignored — they must actually be used or deleted.

**Fix:** Delete dormant private members rather than trying to suppress the warning. If the code is worth keeping for future use, move it to a comment or a separate utility file that isn't compiled into the project.

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

## Bare port 8081 returns nothing without an `index.html`

**Symptom:** Navigating to `https://localhost:8081` shows a blank 404. Users expect the app to open.

**Root cause:** Two entry points (`desktop.html`, `xr.html`) but no root `index.html`. Vite doesn't auto-redirect bare `/` requests to a named entry.

**Fix:** Add a minimal `index.html` at the project root with `<meta http-equiv="refresh" content="0;url=desktop.html" />`.

---

## Vite proxy makes the song server plain HTTP (no TLS needed in dev)

**Pattern:** Add to `vite.config.ts`:
```ts
proxy: {
    '/remote-songs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/remote-songs/, ''),
    },
}
```
The browser (including Quest via Quest Link) hits `https://localhost:8081/remote-songs/manifest.json`. Vite proxies it to the plain HTTP song server. The song server needs no TLS cert and no CORS headers in this mode (same-origin from the browser's perspective). Enter `http://localhost:8081/remote-songs` as the Library URL in the app.

---

## Import paths: no `.js` extensions, `../shared/` prefix for cross-mode imports

**Symptom:** Module not found errors at dev-server startup.

**Root cause:** Porting code that used `.js` extensions on imports (Node16 ESM style) into a Vite project — Vite's bundler resolves `.ts` files directly, so `.js` suffixes on cross-file imports are not needed and cause resolution failures when the file is `.ts`.

**Fix:** Remove all `.js` extensions from imports. Mode-local imports stay `./Foo`, shared imports become `../shared/Foo`.
