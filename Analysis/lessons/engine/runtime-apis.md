# Engine — IWSDK / Three.js / Web Audio API facts

Third-party API gotchas that constrain how code must be written, independent of any specific
screen. See [`INDEX.md`](INDEX.md) for the full engine map.

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

## Three.js: `Object3D.getWorldDirection()` returns +Z, not -Z

**Symptom:** XR guitar volume auto-placement landed exactly behind the player instead of in front of them, with no errors.

**Root cause:** `getWorldDirection()` returns the object's **local +Z axis** in world space (confirmed in `node_modules/three/src/core/Object3D.js`: `target.set(e[8], e[9], e[10])` — the matrix's third column). Cameras/heads look down **-Z** by convention, so this is the *backward* direction for anything camera-like, not forward.

**Fix:** Negate the result when you actually want a look/forward direction: `head.getWorldDirection(forward).negate();`.

---

## IWSDK: any `THREE.Sprite` in the XR scene graph crashes the pointer system

**Symptom:** Enabling XR text (via pooled `THREE.Sprite`s) "totally cratered" frame rate. Nothing in the rendering cost model explained it — a device console dump was needed to actually find the cause.

**Root cause:** IWSDK's built-in hand/controller pointer-ray system walks the *entire* scene graph every frame looking for hit targets — not just objects explicitly tagged `RayInteractable`. `THREE.Sprite.raycast()` (see `node_modules/three/src/objects/Sprite.js`) requires `Raycaster.camera` to be set externally before it can compute the billboard-facing quad for hit-testing. IWSDK's internal raycaster never sets it, so every Sprite in the tree throws a `"Raycaster.camera" needs to be set` console warning every frame, and periodically an uncaught `TypeError: Cannot read properties of null (reading 'matrixWorld')` — inside `world.update()`/`render()`, i.e. the main loop, every frame.

**Fix:** No-op the raycast method on any purely-decorative sprite: `sprite.raycast = () => {};`. Applies to any pooled/dynamic Sprite added to the XR scene graph (`TextBatch.ts`'s constructor does this).

**Diagnosis note:** Two prior hypotheses (a GPU resource leak on scene reload, a stale fret-scroll offset) were checked against source first and ruled out — the actual cause only showed up in the raw browser console (`chrome://inspect`, see `dev-environment.md`). Worth reaching for real console output earlier when a regression doesn't match the code's apparent cost on paper.

---

## IWSDK: `Entity.dispose()` recursively frees GPU resources; `createTransformEntity` uses real `Object3D.add()` underneath

Two related facts, confirmed by reading `node_modules/@iwsdk/core/dist/ecs/{entity,world}.js` and `dist/transform/transform.js`, worth having settled rather than re-investigated next time:

- **`entity.dispose()`** (not `.destroy()`) sets an internal `_disposeResources` flag before destroying, which triggers `world.disposeObject3DResources()` — a full `object.traverse()` that disposes geometry/materials/textures on the *entire* subtree, not just the entity's own object. Reloading a highway via `highwayEntity.dispose()` correctly frees children parented onto it (e.g. a Sprite pool) — this is not a leak source.
- **`createTransformEntity`** ultimately does a genuine `parentObject.add(object)` — it's a real Three.js scene graph under the ECS layer, not a parallel structure. Any plain `Object3D` `.add()`-ed as a child of an already-mounted entity's object (e.g. `quadBatch.mesh`) renders correctly via normal Three.js traversal, without needing to be its own registered entity. This is how XR text rendering reuses `TextBatch`'s sprite pool — parented directly to `quadBatch.mesh` rather than needing a separate entity per sprite.

---

## IWSDK: `visual.model.visible` is reset every frame by InputSystem — a one-shot hide doesn't stick

**Symptom:** Hiding the tracked-hand visual (`XRHandVisualAdapter.toggleVisual(false)`) when the XR panel goes idle appeared to work at the API level (no errors, `enabled` flag flipped correctly) but the hand kept rendering — frozen in its last pose instead of disappearing.

**Root cause:** `toggleVisual()`'s `enabled` flag correctly gates `BaseHandVisual.update()`'s per-frame joint-bone writes (`node_modules/@iwsdk/xr-input/dist/visual/impl/base-impl.js`) — that's why the pose froze. But IWSDK's own `XRInputManager` (`xr-input-manager.js`) unconditionally sets `visualAdapter.visual.model.visible = inputSourceData.isPrimary` for every connected input source on *every frame*, regardless of what any external caller set `.visible` to. A one-shot `toggleVisual(false)` gets silently overwritten the very next frame.

**Fix:** Don't rely on a one-shot toggle for anything that needs to stay hidden across frames while IWSDK's own systems are still running. Instead, force `visual.model.visible = false` every frame for the duration of the hidden state (in `HighwaySystem.update()`, guarded by the same idle condition). No explicit re-show call is needed — stop forcing it false and IWSDK's own per-frame reset naturally makes it visible again with a live (non-frozen) pose, since joint updates were never actually stopped.

**Diagnosis note:** The bug looked like "hiding doesn't work" but was actually two separate effects overlapping (pose freeze + visibility not sticking) that only made sense once `xr-input-manager.js` and `base-impl.js` were read directly — the `enabled`-gates-updates and `.visible`-gets-reset-every-frame behaviors live in different files and aren't documented together anywhere.

---

## A discarded Web Audio object keeps playing unless explicitly stopped

Replacing a `SongPlayer` instance mid-session (e.g. for a highway rebuild) without first calling
its `.pause()` leaves the old `AudioBufferSourceNode` playing in the background — dropping the JS
reference alone doesn't stop it, unlike garbage-collectable state in general.

---

## `QuadBatch.flush()` vs `draw()` — never call `renderer.render()` inside XR

**Symptom:** Black screen or flickering in XR; IWSDK compositor fight.

**Root cause:** IWSDK owns the render loop and calls `renderer.render()` on its schedule. Calling it again inside `Scene3D.draw()` submits a duplicate frame.

**Fix:** Split into `flush()` (marks GPU buffers dirty, sets draw range) and `draw()` (calls `flush()` then `renderer.render()`). In XR mode (`threeScene === null`), call `flush()` only. In desktop mode, call `draw()`.

---

## `super-three@0.181.0` is the unified `three` package for both entry points

**Why this matters:** IWSDK's peer dependency is `super-three` (Meta's Three.js fork). Desktop Three.js must be the same module instance, or you get two `THREE` namespaces and mesh registration fails.

**Fix:** `"three": "npm:super-three@0.181.0"` in `package.json`. Both `desktop.html` and `xr.html` bundles resolve `import * as THREE from 'three'` to the same package.

**Do not upgrade to 0.184.0** — see the entry below about deferred texture uploads.

---

## `super-three@0.184.0` breaks all CanvasTextures in XR multiview mode

**Symptom:** Every CanvasTexture-based element invisible on Quest device: grab bar not visible, IWSDK ray cursor not visible, panel content disappears after any screen navigation. No errors in DevTools. Everything works fine in the browser emulator (IWER).

**Root cause:** The package.json was written with `super-three@0.184.0` (the latest at the time) rather than the `0.181.0` version already in use elsewhere. In WebXR multiview mode (Quest device), Three.js calls `textures.setDeferTextureUploads(true)` before rendering, which queues all CanvasTexture GPU uploads into a deferred list instead of uploading immediately. This list is supposed to be flushed by `textures.runDeferredUploads()` at frame-end. In r181 this call exists (line 17226 of `three.module.js`). In r184, `runDeferredUploads` is defined and exposed on the textures manager but **never called anywhere in the render loop**. The deferred queue accumulates and is never flushed — CanvasTextures never reach the GPU.

The IWER emulator is not affected because it doesn't enable multiview (no `OCULUS_multiview` extension in browser), so texture uploads are not deferred.

**Fix:** Pin to `"three": "npm:super-three@0.181.0"`. Do not upgrade unless the IWSDK itself upgrades and the deferred upload flush is confirmed to be restored in the new version.
