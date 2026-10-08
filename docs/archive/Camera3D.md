# Camera3D.cs — Conversion Analysis

**Source:** `ChartPlayerShared/Camera3D.cs`
**Subclass:** `FretCamera` in `ChartPlayerShared/FretPlayerScene3D.cs`
**Used by:** `Scene3D.cs` (passes view/projection to BasicEffect), `DrumPlayerScene3D.cs`, `KeysPlayerScene3D.cs`

---

## What the class does

A pure data/math class. Stores camera state and computes two matrices on demand:
- **View matrix** — where the camera is and what it's looking at (`CreateLookAt`)
- **Projection matrix** — perspective or orthographic frustum

Those matrices are handed directly to MonoGame's `BasicEffect` as shader uniforms (`Scene3D.cs:84-85`).

---

## Three.js handles this natively

`THREE.PerspectiveCamera` and `THREE.OrthographicCamera` maintain both matrices internally. You don't call `GetProjectionMatrix()` manually — Three.js computes and uploads them during `renderer.render(scene, camera)`. The class becomes a thin wrapper around a `THREE.PerspectiveCamera`.

---

## Property / method mapping

| C# | Three.js | Notes |
|---|---|---|
| `FieldOfView` (radians) | `camera.fov` (degrees) | Must convert: `radians * (180/π)` |
| `NearPlane` / `FarPlane` | `camera.near` / `camera.far` | Direct |
| `ViewportWidth` / `ViewportHeight` | `camera.aspect = w/h` | Three.js takes ratio, not raw dims |
| `GetProjectionMatrix()` | `camera.updateProjectionMatrix()` | Called after changing fov/near/far/aspect |
| `GetViewMatrix()` | internal (`camera.matrixWorldInverse`) | Managed automatically by Three.js |
| `SetLookAt(target)` | `camera.lookAt(target)` | Three.js handles Forward/Right/Up internally |
| `MirrorLeftRight` | `camera.scale.x = -1` | See below |
| `Position` | `camera.position` | Direct |
| `Up` | `camera.up` | Direct |

---

## Conversion challenges

### 1. Coordinate system handedness
- XNA/MonoGame is **left-handed** (positive Z points into the screen)
- Three.js/WebGL is **right-handed** (positive Z points out of the screen)
- `FretCamera` sets `Forward = (0, 0, -1)` which already matches the right-handed convention — a good sign that geometry coords are compatible as-is. Verify if anything appears Z-flipped at runtime.

### 2. FOV units
- XNA: `Math.PI / 4` radians = 45°, vertical FOV
- Three.js: also vertical FOV, but in **degrees**
- `new THREE.PerspectiveCamera(45, aspect, 1, 10000)` is the correct translation of the default

### 3. MirrorLeftRight (Lefty Mode)
- XNA: `Matrix.CreateLookAt(...) * Matrix.CreateScale(-1, 1, 1)` — post-multiplied on the view matrix
- Three.js: `camera.scale.x = -1` achieves the same visual result
- Flipping camera scale inverts face winding, but `Scene3D` already sets `CullNone` everywhere, so no impact on rendering

### 4. Viewport dimensions
- XNA: `ViewportWidth` / `ViewportHeight` are set every frame at draw time (polled in `ChartPlayerGame.Draw()`)
- Three.js: handle reactively via `window.addEventListener('resize', ...)` or `ResizeObserver`, calling `camera.aspect = w/h` + `camera.updateProjectionMatrix()`

---

## Dead code (safe to skip)

- **Orthographic mode** (`IsOrthographic`): never set to `true` anywhere in the codebase. Ported as a stub or omitted.
- **`GetDistanceForWidth`**: not called anywhere. Pure trig — can be ported as a utility if needed later.
- **`Right` vector**: stored on the class but never read back by the matrix methods. Kept for API parity since subclass update logic could reference it.

---

## SetLookAt is called every frame

Both `FretCamera.Update()` and `DrumPlayerScene3D` / `KeysPlayerScene3D` call `SetLookAt` on every update tick. It's not a one-time setup. In the TS port this becomes `camera.lookAt(target)` inside the per-frame update function.

---

## FretCamera.Update() summary

`FretCamera` is the only subclass. Its `Update(minFret, maxFret, targetFocusFret, focusY)` method:
1. Computes a `targetCameraDistance` based on how wide the currently-played fret range is
2. Smoothly lerps `CameraDistance` and `positionFret` toward their targets (eased at 1% and 2% per frame respectively)
3. Sets `Position` and calls `SetLookAt` every frame

This becomes a plain controller class/function in TS that drives `camera.position.set(...)` then `camera.lookAt(...)`. No matrix math required.

---

## Output file
`ThreeCP/Camera3D.ts`
