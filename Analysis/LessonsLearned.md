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

---

## Three.js: `Object3D.getWorldDirection()` returns +Z, not -Z

**Symptom:** XR guitar volume auto-placement landed exactly behind the player instead of in front of them, with no errors.

**Root cause:** `getWorldDirection()` returns the object's **local +Z axis** in world space (confirmed in `node_modules/three/src/core/Object3D.js`: `target.set(e[8], e[9], e[10])` — the matrix's third column). Cameras/heads look down **-Z** by convention, so this is the *backward* direction for anything camera-like, not forward.

**Fix:** Negate the result when you actually want a look/forward direction: `head.getWorldDirection(forward).negate();`.

---

## IWSDK: any `THREE.Sprite` in the XR scene graph crashes the pointer system

**Symptom:** Enabling XR text (via pooled `THREE.Sprite`s) "totally cratered" frame rate. Nothing in the rendering cost model explained it — a device console dump was needed to actually find the cause.

**Root cause:** IWSDK's built-in hand/controller pointer-ray system walks the *entire* scene graph every frame looking for hit targets — not just objects explicitly tagged `RayInteractable`. `THREE.Sprite.raycast()` (see `node_modules/three/src/objects/Sprite.js`) requires `Raycaster.camera` to be set externally before it can compute the billboard-facing quad for hit-testing. IWSDK's internal raycaster never sets it, so every Sprite in the tree throws a `"Raycaster.camera" needs to be set` console warning every frame, and periodically an uncaught `TypeError: Cannot read properties of null (reading 'matrixWorld')` — inside `world.update()`/`render()`, i.e. the main loop, every frame.

**Fix:** No-op the raycast method on any purely-decorative sprite: `sprite.raycast = () => {};`. Applies to any pooled/dynamic Sprite added to the XR scene graph (`TextBatch.ts`'s constructor does this).

**Diagnosis note:** Two prior hypotheses (a GPU resource leak on scene reload, a stale fret-scroll offset) were checked against source first and ruled out — the actual cause only showed up in the raw browser console (`chrome://inspect`, see the entry above). Worth reaching for real console output earlier when a regression doesn't match the code's apparent cost on paper.

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

## Gating async work by a live state flag: the callback needs to re-check too, not just the call site

**Symptom:** An idle-timeout blank overlay for the XR panel (drawn after 3s unhovered) appeared to have no visible effect — it drew correctly, then was immediately undone.

**Root cause:** An `html2canvas` capture already in flight when the panel crossed into "idle" still resolved normally, and its `.then()` callback unconditionally overwrote the canvas with the (stale, pre-idle) captured content. The callback only checked for screen-navigation invalidation (`panelRenderGen`), not for whether the state had changed *while the async call was in flight*.

**Fix:** Re-check the live condition inside the `.then()` callback itself, not just before kicking off the async call: `if (performance.now() - this.lastPanelHoverMs > TIMEOUT) return;` before applying the result.

---

## IWSDK: `Entity.dispose()` recursively frees GPU resources; `createTransformEntity` uses real `Object3D.add()` underneath

Two related facts, confirmed by reading `node_modules/@iwsdk/core/dist/ecs/{entity,world}.js` and `dist/transform/transform.js`, worth having settled rather than re-investigated next time:

- **`entity.dispose()`** (not `.destroy()`) sets an internal `_disposeResources` flag before destroying, which triggers `world.disposeObject3DResources()` — a full `object.traverse()` that disposes geometry/materials/textures on the *entire* subtree, not just the entity's own object. Reloading a highway via `highwayEntity.dispose()` correctly frees children parented onto it (e.g. a Sprite pool) — this is not a leak source.
- **`createTransformEntity`** ultimately does a genuine `parentObject.add(object)` — it's a real Three.js scene graph under the ECS layer, not a parallel structure. Any plain `Object3D` `.add()`-ed as a child of an already-mounted entity's object (e.g. `quadBatch.mesh`) renders correctly via normal Three.js traversal, without needing to be its own registered entity. This is how XR text rendering reuses `TextBatch`'s sprite pool — parented directly to `quadBatch.mesh` rather than needing a separate entity per sprite.

---

## XR settings/menu panels are html2canvas-rendered images, not live DOM — no native checkbox/change events

**Symptom:** Naively porting a desktop settings toggle (`<input type="checkbox">` + `change` listener) to the XR settings panel would silently do nothing.

**Root cause:** The XR panel (`uiPanel`) is a real DOM tree, but it's never actually interacted with directly — it's rasterized via `html2canvas` onto a `CanvasTexture` displayed on a 3D plane. All "clicks" are synthetic: a hand-ray raycast hit against the plane, mapped back to pixel coordinates, checked against registered elements' `getBoundingClientRect()`, and dispatched through a manual `xrButtons: XrButton[]` registry (`{el, onClick}`) — never real browser events.

**Fix:** Any interactive control in an XR panel must be a clickable element (typically a `<button>`) registered via `xrButtons.push({el, onClick})`, not a native form control relying on `change`/`input` events. The established pattern for booleans here is an On/Off button pair with active-state styling (see `toggleRowHtml()` in `XRSettingsScene.ts`).

---

## IWSDK: `visual.model.visible` is reset every frame by InputSystem — a one-shot hide doesn't stick

**Symptom:** Hiding the tracked-hand visual (`XRHandVisualAdapter.toggleVisual(false)`) when the XR panel goes idle appeared to work at the API level (no errors, `enabled` flag flipped correctly) but the hand kept rendering — frozen in its last pose instead of disappearing.

**Root cause:** `toggleVisual()`'s `enabled` flag correctly gates `BaseHandVisual.update()`'s per-frame joint-bone writes (`node_modules/@iwsdk/xr-input/dist/visual/impl/base-impl.js`) — that's why the pose froze. But IWSDK's own `XRInputManager` (`xr-input-manager.js`) unconditionally sets `visualAdapter.visual.model.visible = inputSourceData.isPrimary` for every connected input source on *every frame*, regardless of what any external caller set `.visible` to. A one-shot `toggleVisual(false)` gets silently overwritten the very next frame.

**Fix:** Don't rely on a one-shot toggle for anything that needs to stay hidden across frames while IWSDK's own systems are still running. Instead, force `visual.model.visible = false` every frame for the duration of the hidden state (in `HighwaySystem.update()`, guarded by the same idle condition). No explicit re-show call is needed — stop forcing it false and IWSDK's own per-frame reset naturally makes it visible again with a live (non-frozen) pose, since joint updates were never actually stopped.

**Diagnosis note:** The bug looked like "hiding doesn't work" but was actually two separate effects overlapping (pose freeze + visibility not sticking) that only made sense once `xr-input-manager.js` and `base-impl.js` were read directly — the `enabled`-gates-updates and `.visible`-gets-reset-every-frame behaviors live in different files and aren't documented together anywhere.
