# Lessons Learned — Combined Project

Gotchas and hard-won decisions specific to the Combined (desktop + XR) project. For XRProto-only issues (/@fs/ cross-drive, IWSDK grab API, ADB debugging) see `ThreeCP/Analysis/LessonsLearned.md`.

---

## `Scene3D.xrMode = true` must be set before any scene construction

**Symptom:** XR scenes create an owned `THREE.Scene`, add the QuadBatch mesh to it, then fail when IWSDK tries to register the same mesh — or the mesh renders twice.

**Root cause:** `Scene3D.xrMode` is a static flag checked in the constructor. Any code path that constructs a `Scene3D` subclass before the flag is set will create a `THREE.Scene` and add the mesh to it.

**Fix:** Set `Scene3D.xrMode = true` at the very top of `src/xr/index.ts`, before any other imports that could transitively construct a scene. It's the first executable line in the XR entry point.

---

## `verbatimModuleSyntax` requires `import type` for every type-only import

**Symptom:** `error TS1484: 'AssetManifest' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.`

**Root cause:** `verbatimModuleSyntax` requires that any symbol used only as a type in the current file be imported with `import type` or `import { type X }`. Importing it as a value triggers an error even if it happens to be erased at runtime.

**Fix:** Use `import { type AssetManifest, ... }` (inline `type` keyword per symbol) or `import type { ... }` for the whole import. Watch for this any time you import an interface or type alias from a module that also exports values.

---

## Unused imports from `Settings` cause `noUnusedLocals` errors

**Symptom:** `error TS6133: 'saveSettings' is declared but its value is never read.`

**Root cause:** `index.ts` imported `saveSettings` because the v1 version used it directly. In the Combined XR path, `XRSettingsScene` owns that call internally — `index.ts` only needs `loadSettings`.

**Fix:** Remove unused named imports. Check every import you carry over from a source file against what the destination file actually calls.

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

## `QuadBatch.flush()` vs `draw()` — never call `renderer.render()` inside XR

**Symptom:** Black screen or flickering in XR; IWSDK compositor fight.

**Root cause:** IWSDK owns the render loop and calls `renderer.render()` on its schedule. Calling it again inside `Scene3D.draw()` submits a duplicate frame.

**Fix:** Split into `flush()` (marks GPU buffers dirty, sets draw range) and `draw()` (calls `flush()` then `renderer.render()`). In XR mode (`threeScene === null`), call `flush()` only. In desktop mode, call `draw()`.

---

## `KeysPlayerScene3D` in Combined uses XRProto's constructor (no Camera3D arg)

**Symptom:** Desktop `ActiveSceneScreen` passes a `Camera3D` that `KeysPlayerScene3D` no longer accepts — build error or silent mismatch.

**Root cause:** v1's `KeysPlayerScene3D` took an explicit `Camera3D` parameter. XRProto's version creates the camera internally. Combined uses XRProto's constructor as canonical.

**Fix:** Remove `Camera3D` construction from `ActiveSceneScreen`. Construct `KeysPlayerScene3D` with just `(renderer, texture, songStructure, keyboardNotes)`. The internal camera reads viewport size from `renderer.getSize()`.

---

## Piano image asset must live in `src/shared/assets/`, not `src/desktop/`

**Symptom:** `import pianoImageUrl from './assets/piano.png'` fails in `KeysPlayerScene3D.ts` because the file is in `src/desktop/assets/`.

**Root cause:** `KeysPlayerScene3D.ts` is a shared file in `src/shared/`. It can't import relative assets from `src/desktop/`.

**Fix:** Copy `piano.png` to `src/shared/assets/piano.png` and import from `'./assets/piano.png'` within the shared module. Vite resolves it correctly from either entry point.

---

## `super-three@0.181.0` is the unified `three` package for both entry points

**Why this matters:** IWSDK's peer dependency is `super-three` (Meta's Three.js fork). Desktop Three.js must be the same module instance, or you get two `THREE` namespaces and mesh registration fails.

**Fix:** `"three": "npm:super-three@0.181.0"` in `package.json`. Both `desktop.html` and `xr.html` bundles resolve `import * as THREE from 'three'` to the same package.

**Do not upgrade to 0.184.0** — see the entry below about deferred texture uploads.

---

## `super-three@0.184.0` breaks all CanvasTextures in XR multiview mode

**Symptom:** Every CanvasTexture-based element invisible on Quest device: grab bar not visible, IWSDK ray cursor not visible, html2canvas panel disappears after any screen navigation. No errors in DevTools. Everything works fine in the browser emulator (IWER).

**Root cause:** When merging XRProto into Combined, the package.json was written with `super-three@0.184.0` (the latest at the time) rather than the `0.181.0` version XRProto was using. The user never asked for Three.js to be upgraded.

In WebXR multiview mode (Quest device), Three.js calls `textures.setDeferTextureUploads(true)` before rendering, which queues all CanvasTexture GPU uploads into a deferred list instead of uploading immediately. This list is supposed to be flushed by `textures.runDeferredUploads()` at frame-end. In r181 this call exists (line 17226 of `three.module.js`). In r184, `runDeferredUploads` is defined and exposed on the textures manager but **never called anywhere in the render loop**. The deferred queue accumulates and is never flushed — CanvasTextures never reach the GPU.

The IWER emulator is not affected because it doesn't enable multiview (no `OCULUS_multiview` extension in browser), so texture uploads are not deferred.

**Fix:** Pin to `"three": "npm:super-three@0.181.0"`. Do not upgrade unless the IWSDK itself upgrades and the deferred upload flush is confirmed to be restored in the new version.

---

## `compileUIKit` plugin crashes dev server if `ui/` directory is missing

**Symptom:** `npm run dev` starts but neither `desktop.html` nor `xr.html` load; browser shows nothing at `/xr.html`.

**Root cause:** `compileUIKit({ sourceDir: "ui" })` in `vite.config.ts` expects a `ui/` directory to exist at project root. If it's absent (as it was when Combined was first created), the plugin throws during Vite startup, silently preventing any page from being served.

**Fix:** Copy the `ui/` directory from `XRProto/`. Also ensure `public/UISheet0.png`, `favicon.svg`, and `icons.svg` exist — they're not baked by a tool and must be manually copied from `Project/public/`.

---

## Bare port 8081 returns nothing without an `index.html`

**Symptom:** Navigating to `https://localhost:8081` shows a blank 404. Users expect the app to open.

**Root cause:** Combined has two entry points (`desktop.html`, `xr.html`) but no root `index.html`. Vite doesn't auto-redirect bare `/` requests to a named entry.

**Fix:** Add a minimal `index.html` at the project root with `<meta http-equiv="refresh" content="0;url=desktop.html" />`.

---

## `SourcedEntry` — tag entries with their source at load time, not at use time

**Why:** Once songs from multiple sources are merged into a flat list, there's no reliable way to look up which source an entry came from unless you stored it upfront. Trying to match by folder path at use time is fragile (two sources could have the same folder name).

**Pattern:** `interface SourcedEntry { entry: SongIndexEntry; source: ISongSource }`. Build this array in `loadAllSources()` during the manifest phase. All downstream code receives `SourcedEntry` and calls `sourced.source.getFileUrl(sourced.entry, filename)` — no source lookup needed.

---

## URL-based sources eliminate `URL.createObjectURL` and async album art checks

**Old pattern (file handles):** `getSongFile(entry, 'song.ogg')` returned a `File`; callers called `URL.createObjectURL(file)`, used the URL, then `URL.revokeObjectURL`. Album art existence had to be checked asynchronously via the file handle.

**New pattern (URL sources):** `source.getFileUrl(entry, 'song.ogg')` returns a plain HTTP URL string. Pass it directly to `SongPlayer.loadSong()`. Album art: `source.getAlbumArtUrl(entry)` returns a URL synchronously; use `onerror="this.style.display='none'"` on the `<img>` to handle missing art — no pre-flight fetch needed.

---

## `Promise.allSettled` in `loadAllSources` keeps baked songs working when remote fails

**Why:** Using `Promise.all` would cause the entire library load to reject if the remote server is down. With `Promise.allSettled`, each source is independent — a failing remote source logs a warning and the baked demo songs still appear.

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

## XR hover feedback requires `.xr-hover` CSS class alongside `:hover`

**Symptom:** Interactive elements (sort trigger, song cards) show no visual response to ray hover in XR, even though they are correctly registered in `xrButtons` and `onClick` fires.

**Root cause:** `HighwaySystem` signals hover by adding the `xr-hover` class to the element (`el.classList.add('xr-hover')`), never by triggering the CSS `:hover` pseudo-class. `:hover` is only activated by actual pointer/mouse events, which don't exist in XR. Any element using a custom CSS class (`.sort-trigger`, `.song-entry`, etc.) must explicitly handle `.xr-hover` in its rules.

Elements that use `button.primary-dark` / `button.primary-light` from `panel.css` are already covered — that file pairs `:hover` and `.xr-hover` together. Custom CSS classes are not.

**Fix:** For every interactive XR element that uses a custom style, pair the hover rule:
```css
.my-element:hover,
.my-element.xr-hover { background: #515151; }
```

**Where this applies:** `library.css` — `.sort-trigger`, `.sort-option`, `.song-entry`. Any new screen with custom button styles needs the same pattern.

---

## `_` prefix does not suppress `noUnusedLocals` for private class members

**Symptom:** `error TS6133: '_connectOpen' is declared but its value is never read.` — renaming a private field or method to `_foo` still triggers the error.

**Root cause:** TypeScript's `noUnusedLocals` only treats the underscore prefix as a suppression signal for **function parameters** (e.g. `(_unused: string) => {}`). For private class fields and private methods, the prefix is ignored — they must actually be used or deleted.

**Fix:** Delete dormant private members rather than trying to suppress the warning. If the code is worth keeping for future use, move it to a comment or a separate utility file that isn't compiled into the project.

---

## `hasArt` flag in manifest avoids HEAD requests for missing album art

**Pattern:** When baking or serving the song manifest, compute `hasArt: existsSync(join(dir, 'albumart.png'))` per entry. `ISongSource.getAlbumArtUrl()` returns `null` synchronously when `!entry.hasArt`, so the caller never constructs an `<img>` that fires a 404 request.

Without this flag, every song entry would need either a pre-flight HEAD request or a fallback `onerror` handler on every image element. The flag is cheap to compute at build/serve time and keeps the runtime path synchronous.

**Where this is implemented:** `tools/bake-songs.ts`, `tools/song-server.ts` (both set `hasArt`), `SongSource.ts` (`getAlbumArtUrl` checks it), `XRSongLibrary.ts` and `XRPreScene.ts` (use the returned URL or render a placeholder div).

---

## Import paths in Combined: no `.js` extensions, `../shared/` prefix

**Symptom:** Module not found errors at dev-server startup.

**Root cause:** XRProto used `.js` extensions on imports (Node16 ESM style). Vite's bundler resolves `.ts` files directly — `.js` suffixes on cross-file imports are not needed and cause resolution failures when the file is `.ts`.

**Fix:** Remove all `.js` extensions from imports. XR-local imports stay `./Foo`, shared imports become `../shared/Foo`.
