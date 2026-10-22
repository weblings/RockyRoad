# Engine — IWSDK / Three.js / Web Audio API facts

Id: lesson-engine-runtime-apis

Third-party API gotchas that constrain how code must be written, independent of any specific
screen. See [`INDEX.md`](INDEX.md) for the full engine map.

---

## IWSDK: `OneHandGrabbable` uses squeeze, not trigger
Tags: iwsdk, grab, squeeze, input
Applies-when: wiring grab interaction or writing grab UX copy

**Symptom:** Grab doesn't activate when holding the trigger over an object.

**Root cause:** `OneHandGrabbable` (proximity-based grab) is activated by the **squeeze** button. The trigger is the ray-select button used by `RayInteractable`.

**Fix:** Use squeeze to grab. Update any UX copy that says "hold trigger to grab."

---

## IWSDK: `Interactable` is deprecated
Tags: iwsdk, ray-interactable, interactable
Applies-when: making an entity respond to controller rays

**Symptom:** Adding `Interactable` to an entity produces no ray cursor response.

**Root cause:** `Interactable` was replaced by `RayInteractable` (ray/pointer) and `PokeInteractable` (touch). `OneHandGrabbable` requires `RayInteractable`, not the old component.

**Fix:** Use `RayInteractable` for any entity that should respond to controller rays.

---

## Three.js: `Object3D.getWorldDirection()` returns +Z, not -Z
Tags: three, direction, camera, placement
Applies-when: computing a forward/look direction from an Object3D

**Symptom:** XR guitar volume auto-placement landed exactly behind the player instead of in front of them, with no errors.

**Root cause:** `getWorldDirection()` returns the object's **local +Z axis** in world space (confirmed in `node_modules/three/src/core/Object3D.js`: `target.set(e[8], e[9], e[10])` — the matrix's third column). Cameras/heads look down **-Z** by convention, so this is the *backward* direction for anything camera-like, not forward.

**Fix:** Negate the result when you actually want a look/forward direction: `head.getWorldDirection(forward).negate();`.

---

## IWSDK: any `THREE.Sprite` in the XR scene graph crashes the pointer system
Tags: iwsdk, sprite, raycast, pointer, performance
Applies-when: adding a THREE.Sprite to the XR scene, or an unexplained XR frame-rate crash

**Symptom:** Enabling XR text (via pooled `THREE.Sprite`s) "totally cratered" frame rate. Nothing in the rendering cost model explained it — a device console dump was needed to actually find the cause.

**Root cause:** IWSDK's built-in hand/controller pointer-ray system walks the *entire* scene graph every frame looking for hit targets — not just objects explicitly tagged `RayInteractable`. `THREE.Sprite.raycast()` (see `node_modules/three/src/objects/Sprite.js`) requires `Raycaster.camera` to be set externally before it can compute the billboard-facing quad for hit-testing. IWSDK's internal raycaster never sets it, so every Sprite in the tree throws a `"Raycaster.camera" needs to be set` console warning every frame, and periodically an uncaught `TypeError: Cannot read properties of null (reading 'matrixWorld')` — inside `world.update()`/`render()`, i.e. the main loop, every frame.

**Fix:** No-op the raycast method on any purely-decorative sprite: `sprite.raycast = () => {};`. Applies to any pooled/dynamic Sprite added to the XR scene graph (`TextBatch.ts`'s constructor does this).

**Diagnosis note:** Two prior hypotheses (a GPU resource leak on scene reload, a stale fret-scroll offset) were checked against source first and ruled out — the actual cause only showed up in the raw browser console (`chrome://inspect`, see `dev-environment.md`). Worth reaching for real console output earlier when a regression doesn't match the code's apparent cost on paper.

---

## IWSDK: `Entity.dispose()` recursively frees GPU resources; `createTransformEntity` uses real `Object3D.add()` underneath
Tags: iwsdk, entity, dispose, scene-graph, gpu-resources
Applies-when: disposing entities or parenting plain Object3Ds under an entity

Two related facts, confirmed by reading `node_modules/@iwsdk/core/dist/ecs/{entity,world}.js` and `dist/transform/transform.js`, worth having settled rather than re-investigated next time:

- **`entity.dispose()`** (not `.destroy()`) sets an internal `_disposeResources` flag before destroying, which triggers `world.disposeObject3DResources()` — a full `object.traverse()` that disposes geometry/materials/textures on the *entire* subtree, not just the entity's own object. Reloading a highway via `highwayEntity.dispose()` correctly frees children parented onto it (e.g. a Sprite pool) — this is not a leak source.
- **`createTransformEntity`** ultimately does a genuine `parentObject.add(object)` — it's a real Three.js scene graph under the ECS layer, not a parallel structure. Any plain `Object3D` `.add()`-ed as a child of an already-mounted entity's object (e.g. `quadBatch.mesh`) renders correctly via normal Three.js traversal, without needing to be its own registered entity. This is how XR text rendering reuses `TextBatch`'s sprite pool — parented directly to `quadBatch.mesh` rather than needing a separate entity per sprite.

---

## IWSDK: `visual.model.visible` is reset every frame by InputSystem — a one-shot hide doesn't stick
Tags: iwsdk, hand-tracking, visibility, input
Applies-when: hiding the tracked-hand or controller visual

**Symptom:** Hiding the tracked-hand visual (`XRHandVisualAdapter.toggleVisual(false)`) when the XR panel goes idle appeared to work at the API level (no errors, `enabled` flag flipped correctly) but the hand kept rendering — frozen in its last pose instead of disappearing.

**Root cause:** `toggleVisual()`'s `enabled` flag correctly gates `BaseHandVisual.update()`'s per-frame joint-bone writes (`node_modules/@iwsdk/xr-input/dist/visual/impl/base-impl.js`) — that's why the pose froze. But IWSDK's own `XRInputManager` (`xr-input-manager.js`) unconditionally sets `visualAdapter.visual.model.visible = inputSourceData.isPrimary` for every connected input source on *every frame*, regardless of what any external caller set `.visible` to. A one-shot `toggleVisual(false)` gets silently overwritten the very next frame.

**Fix:** Don't rely on a one-shot toggle for anything that needs to stay hidden across frames while IWSDK's own systems are still running. Instead, force `visual.model.visible = false` every frame for the duration of the hidden state (in `HighwaySystem.update()`, guarded by the same idle condition). No explicit re-show call is needed — stop forcing it false and IWSDK's own per-frame reset naturally makes it visible again with a live (non-frozen) pose, since joint updates were never actually stopped.

**Diagnosis note:** The bug looked like "hiding doesn't work" but was actually two separate effects overlapping (pose freeze + visibility not sticking) that only made sense once `xr-input-manager.js` and `base-impl.js` were read directly — the `enabled`-gates-updates and `.visible`-gets-reset-every-frame behaviors live in different files and aren't documented together anywhere.

---

## A discarded Web Audio object keeps playing unless explicitly stopped
Tags: web-audio, song-player, cleanup
Applies-when: replacing a SongPlayer or audio source mid-session

Replacing a `SongPlayer` instance mid-session (e.g. for a highway rebuild) without first calling
its `.pause()` leaves the old `AudioBufferSourceNode` playing in the background — dropping the JS
reference alone doesn't stop it, unlike garbage-collectable state in general.

---

## `QuadBatch.flush()` vs `draw()` — never call `renderer.render()` inside XR
Tags: quadbatch, render-loop, iwsdk, xr
Applies-when: calling render in XR, or black screen/flicker in XR

**Symptom:** Black screen or flickering in XR; IWSDK compositor fight.

**Root cause:** IWSDK owns the render loop and calls `renderer.render()` on its schedule. Calling it again inside `Scene3D.draw()` submits a duplicate frame.

**Fix:** Split into `flush()` (marks GPU buffers dirty, sets draw range) and `draw()` (calls `flush()` then `renderer.render()`). In XR mode (`threeScene === null`), call `flush()` only. In desktop mode, call `draw()`.

---

## `super-three@0.181.0` is the unified `three` package for both entry points
Tags: three, super-three, package-version, dependencies
Applies-when: changing the three/super-three dependency

**Why this matters:** IWSDK's peer dependency is `super-three` (Meta's Three.js fork). Desktop Three.js must be the same module instance, or you get two `THREE` namespaces and mesh registration fails.

**Fix:** `"three": "npm:super-three@0.181.0"` in `package.json`. Both `desktop.html` and `xr.html` bundles resolve `import * as THREE from 'three'` to the same package.

**Do not upgrade to 0.184.0** — see the entry below about deferred texture uploads.

---

## `CanvasTexture` defaults to `NoColorSpace` — dark colors render much lighter than drawn
Tags: canvas-texture, color-space, srgb
Applies-when: a CanvasTexture renders lighter or washed out

**Symptom:** A canvas 2D background fill of `#0a0a0a` (matching every other panel's near-black)
rendered on a `Sprite` as a noticeably lighter gray, close to `#333333`.

**Root cause:** `Texture`'s (and therefore `CanvasTexture`'s) default `colorSpace` is `NoColorSpace`
— the renderer never sRGB-decodes the canvas's pixel values on read, so a value meant to already be
in sRGB terms gets treated as linear instead. It then gets sRGB-*encoded* on output regardless,
which disproportionately brightens small (dark) values — the double-conversion. This happens even
on fully unlit materials like `SpriteMaterial` (confirmed directly in its shader: zero lighting
includes, but `colorspace_fragment` still runs), so "it's unlit" doesn't rule this out.

**Fix:** Set `texture.colorSpace = THREE.SRGBColorSpace` on any `CanvasTexture` drawn with normal
web colors. Bright/white content is far less visibly affected (the curve barely moves values near
1.0) — this mostly shows up as an unexplained washed-out look on dark fills specifically.

---

## `super-three@0.184.0` breaks all CanvasTextures in XR multiview mode
Tags: three, super-three, multiview, canvas-texture, quest
Applies-when: upgrading three, or CanvasTextures invisible on Quest but fine in IWER

**Symptom:** Every CanvasTexture-based element invisible on Quest device: grab bar not visible, IWSDK ray cursor not visible, panel content disappears after any screen navigation. No errors in DevTools. Everything works fine in the browser emulator (IWER).

**Root cause:** The package.json was written with `super-three@0.184.0` (the latest at the time) rather than the `0.181.0` version already in use elsewhere. In WebXR multiview mode (Quest device), Three.js calls `textures.setDeferTextureUploads(true)` before rendering, which queues all CanvasTexture GPU uploads into a deferred list instead of uploading immediately. This list is supposed to be flushed by `textures.runDeferredUploads()` at frame-end. In r181 this call exists (line 17226 of `three.module.js`). In r184, `runDeferredUploads` is defined and exposed on the textures manager but **never called anywhere in the render loop**. The deferred queue accumulates and is never flushed — CanvasTextures never reach the GPU.

The IWER emulator is not affected because it doesn't enable multiview (no `OCULUS_multiview` extension in browser), so texture uploads are not deferred.

**Fix:** Pin to `"three": "npm:super-three@0.181.0"`. Do not upgrade unless the IWSDK itself upgrades and the deferred upload flush is confirmed to be restored in the new version.

---

## Quest Browser can't show a permission prompt inside an immersive session
Tags: quest, webxr, getusermedia, microphone, permissions
Applies-when: a feature needs a browser permission (mic, camera) that may not be granted yet

**Symptom:** With site and browser mic permission already granted, `getUserMedia` starts on entering XR. Without it, the request fires but the prompt only appears after the user leaves immersive mode.

**Root cause:** Browser permission UI isn't rendered in the headset during a session, so a first-time request made there stalls unseen.

**Fix:** Read `navigator.permissions.query({ name: 'microphone' })` on entry. If it is `prompt`, show a card with an Allow Mic button whose click calls `getUserMedia` directly. That call from a button gesture raises the real Quest prompt, so no custom page prompt is needed. The prompt is still outside immersive mode, so the card tells the user to exit, allow and re-enter. Permission is per origin. The permission state tells the cases apart: `prompt` (not asked), `denied` (site's Not Allowed list) and `granted`. With the OS Browser mic toggle off, `getUserMedia` never settles and the state reads `granted`, so detect it with a short hang timer (500ms, a real grant takes about 75ms), not a catch. The pending call resolves by itself when the toggle is turned on. Page code can't see Browser's own dialogs (no focus or visibility events). Unblocking a denied site returns the state to `prompt`, not `granted`, so a flat-page toast must offer an Allow button (click-initiated `getUserMedia`) before confirming. The in-VR card should re-read the state periodically, since the user changes it outside VR. Verified on Quest 2026-10-20.

---

## Raising mic gain doesn't make a normalized pitch detector more accurate
Tags: pitch-detection, gain, rms, microphone, autocorrelation
Applies-when: a quiet mic (Quest) makes the tuner or note detector miss or need the instrument held close

**Symptom:** Even at max gain the Quest mic needed the guitar held at the headset. Doubling the gain range to 48x got through all six strings but gave no accuracy benefit.

**Root cause:** `PitchDetector` is a normalized autocorrelation, so scaling the signal doesn't change the pitch. Gain only lets weak frames past the `rms < minRms` silence cutoff, and it amplifies mic noise by the same factor.

**Fix:** Lower the cutoff for the quiet device (`PitchDetector.create`'s `minRms`, XR uses 0.001) and keep the clarity gates. Don't extend the gain slider to compensate.

---

## Quest built-in mic gates guitar to digital silence, and a USB mic bypasses it
Tags: quest, microphone, noise-gate, usb, pitch-detection
Applies-when: the tuner or note detector gets few or no pitches from the Quest built-in mic

**Symptom:** On the built-in mic, 51 to 69% of captured samples were exact zeros, the detector found a pitch on about 21% of frames, and low strings were missing their fundamentals. A web tuner also failed at normal playing distance, yet speech made it jump.

**Root cause:** The platform applies processing below the browser. `getUserMedia` reported `noiseSuppression`, `echoCancellation` and `autoGainControl` all false at 48 kHz, so the constraints are honored in name only. AirPods routed as "Headset earpiece" were no better.

**Fix:** Use an external mic. With a USB mic (ATR2100x-USB, a foot from the guitar) there were no gated blocks and 72% of frames had a pitch. Quest needs Settings > Experimental > External Microphone on, plus a restart, before a USB mic is listed. The tuner now prefers a non-built-in input and warns when only built-in ones exist.

---

## A lowered pitch floor needs the McLeod key-maximum rule or sub-octaves win
Tags: pitch-detection, autocorrelation, nsdf, octave-error, mcleod
Applies-when: the detector reports a string at half, a third or a quarter of its pitch

**Symptom:** After lowering the minimum frequency, D read 73 Hz, G read 98 Hz and B or high E read 82 Hz. The tuner correction of plus or minus one octave cannot fix a third or quarter.

**Root cause:** The detector took the tallest NSDF peak. A multiple of the true period can be slightly taller, and a longer search range exposes more of them.

**Fix:** Take the first peak within 90% of the tallest (`KEY_RATIO` in `PitchDetector.ts`). Replayed on a live recording this cut octave-off frames from 234 to 58. Readings a fourth or third below the target are usually the previous string still ringing, not detector errors.

---

## Room and table rumble reads as a 30 Hz note unless the floor follows the lowest target
Tags: pitch-detection, high-pass, rumble, min-frequency
Applies-when: idle frames report a pitch near 30 Hz or the low string rarely registers

**Symptom:** With a clean USB mic, 767 frames read below 60 Hz and low E (82 Hz) hit only 95 times.

**Fix:** `PitchDetector.create` takes `minHz`, which limits the lag search and sets a high-pass at 0.9 times that. XR passes 0.8 times its lowest target, so bass and drop tunings still work. The same replay gave 0 rumble frames and 258 low E hits.

---

## A page cannot open Quest OS Settings or Browser settings
Tags: quest, webxr, settings, deep-link, permissions
Applies-when: a card wants a button that jumps the user to a Settings screen

**Symptom:** `systemux://settings` and `chrome://settings` (also `chrome://settings/content/microphone`) from a click did not open anything. `location.href` to `systemux://settings` exited immersive mode and stopped there.

**Root cause:** Meta documents `systemux://` for installed native apps only. A web page may not navigate to `chrome://`. Tried on Quest: `location.href`, a clicked `<a>`, `window.open` and an `intent://` URL, all with no effect.

**Fix:** Show the written path instead. The Browser's own settings open as a separate browser tab and reach the same Allowed and Not Allowed list at Settings > Privacy and Security > Website Permissions > Microphone (or Settings > Site Settings > Microphone through `chrome://settings` typed by hand). Do not add a jump button.

---

## window.requestAnimationFrame stalls while an XR session is presenting
Tags: webxr, requestAnimationFrame, setTimeout, xr-session
Applies-when: work scheduled with rAF stops or lags only while in XR

**Symptom:** Returning to Library mid-session built only the first 12 song rows and the rest appeared
about 7 seconds later. Rows were appended one batch per `requestAnimationFrame`.

**Root cause:** the page's rAF is paused while an immersive session presents. The first build ran before
entering XR, so it looked fine.

**Fix:** schedule with `setTimeout` (batches use 16 ms in `XRSongLibrary.ts`), or the session's own loop,
for anything that must run in XR.
