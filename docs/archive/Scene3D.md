# Scene3D.cs + QuadBatch.cs — Conversion Analysis

**Sources:** `ChartPlayerShared/Scene3D.cs`, `ChartPlayerShared/QuadBatch.cs`
**Role:** Base 3D rendering class. Owns the camera, shader, and geometry batch. Subclassed by all player scenes.

---

## Architecture overview

```
Scene3D
├── Camera3D            — view/projection
├── BasicEffect         — MonoGame's built-in position/color/texture shader
└── QuadBatch           — CPU-side dynamic geometry batcher
      ├── VertexBuffer  — GPU vertex buffer (pre-allocated, maxQuads * 4 verts)
      └── IndexBuffer   — GPU index buffer (pre-allocated, maxQuads * 6 indices)
```

Every frame:
1. Camera matrices pushed to the shader
2. `DrawQuads()` called (virtual — subclasses override this to submit geometry)
3. QuadBatch flushed: vertex data uploaded to GPU, single indexed draw call

---

## QuadBatch — the core rendering primitive

This is a **CPU-side dynamic geometry batcher**. The pattern:

- Pre-allocate a large CPU-side `float[]` and GPU buffers once at startup (`maxQuads = 43,688`)
- Each frame: `Begin()` resets the counter
- `AddQuad(verts)` copies 4 vertices into the CPU buffer
- `Draw(effect)` uploads the used portion to the GPU and issues one `DrawIndexedPrimitives` call

Index pattern per quad: `[0,1,2, 0,2,3]` — two triangles sharing the diagonal edge (verts 0 and 2).

**Vertex format** (`VertexPositionColorTexture`):
| Field | Type | Size |
|---|---|---|
| `Position` | Vector3 | 3 floats |
| `Color` | Color (RGBA) | 4 bytes |
| `TextureCoordinate` | Vector2 | 2 floats |

---

## Texture atlas

All images are packed into a **single texture atlas**. `UIImage` stores pixel coordinates within that atlas:
- `XOffset`, `YOffset` — top-left pixel in the atlas
- `Width`, `Height` — dimensions of this image
- `ActualWidth`, `ActualHeight` — full atlas dimensions

UV coords are computed as `pixelOffset / atlasSize`. All quads share one texture — the atlas — so the whole frame is a single draw call with no texture switching.

`SingleWhitePixelImage.Texture` is a reference to the atlas texture (the white pixel is one entry within it, used for solid-color quads).

---

## GPU state set in Draw()

| XNA | Three.js equivalent |
|---|---|
| `BlendState.AlphaBlend` | `material.transparent = true`, `material.blending = THREE.NormalBlending` |
| `DepthStencilState.None` | `material.depthWrite = false`, `material.depthTest = false` |
| `RasterizerState.CullNone` | `material.side = THREE.DoubleSide` |
| `SamplerState.AnisotropicClamp` | `texture.anisotropy = renderer.capabilities.getMaxAnisotropy()`, `texture.wrapS/wrapT = THREE.ClampToEdgeWrapping` |
| `World = Matrix.Identity` | No transform applied to the mesh (`mesh.matrixAutoUpdate = false`, identity matrixWorld) |

**No depth testing** is significant — the entire scene is rendered in pure draw order, like a painter's algorithm. There is no Z-buffer involvement.

---

## DrawQuad variants

Three overloads, all ultimately call `quadBatch.AddQuad(verts)`:

1. **Full image UVs** — maps the entire image onto the quad
2. **Sub-rectangle UVs** — maps a `Rectangle` sub-region of the image (sprite sheet slicing)
3. **Nine-patch** — 3×3 grid of 9 quads for scalable bordered panels

### Nine-patch detail
The `blah` array `[0, 0.05, 0.95, 1.0]` defines the inner/outer UV boundaries. Note: it uses `0.05` / `0.95` as hardcoded inner border fractions rather than the computed `xPercents`/`yPercents` — this looks like intentional overriding of the corner-size parameter for the UV mapping specifically. The comment says "Assumes that image is a parallelogram" — positions are interpolated across the quad corners with `over` and `down` vectors, so the nine-patch works in 3D space, not screen space.

---

## Three.js equivalent architecture

`Scene3D` + `QuadBatch` maps to a **`THREE.BufferGeometry` with dynamic attributes**:

```
Scene3D (TS)
├── camera: THREE.PerspectiveCamera
├── scene: THREE.Scene
├── renderer: THREE.WebGLRenderer   (owned by App, passed in)
└── QuadBatch (TS)
      ├── geometry: THREE.BufferGeometry
      │     ├── position: Float32Array  (maxQuads * 4 * 3)
      │     ├── color:    Float32Array  (maxQuads * 4 * 3)
      │     └── uv:       Float32Array  (maxQuads * 4 * 2)
      ├── indices: Uint16Array          (maxQuads * 6, static)
      └── material: THREE.MeshBasicMaterial
            ├── vertexColors: true
            ├── map: THREE.Texture      (the atlas)
            ├── transparent: true
            ├── depthWrite: false
            ├── depthTest: false
            └── side: THREE.DoubleSide
```

Each frame:
1. `quadBatch.begin()` — reset write cursor
2. Subclass `drawQuads()` fills the CPU arrays
3. `quadBatch.draw()` — mark attributes `needsUpdate = true`, call `renderer.render(scene, camera)`

### Dynamic geometry in Three.js
```ts
geometry.attributes.position.needsUpdate = true;
geometry.attributes.color.needsUpdate = true;
geometry.attributes.uv.needsUpdate = true;
geometry.setDrawRange(0, numQuads * 6); // only draw populated indices
```

`setDrawRange` is the Three.js equivalent of only uploading `numQuads * 4` verts — it tells the renderer not to draw beyond the populated range.

---

## Capacity

`new QuadBatch(43688)` — 43,688 quads × 4 verts = **174,752 vertices** per frame. This is the pre-allocated maximum. The equivalent `Float32Array` sizes:

| Buffer | Elements | Bytes |
|---|---|---|
| position | 174,752 × 3 = 524,256 floats | ~2 MB |
| color | 174,752 × 3 = 524,256 floats | ~2 MB |
| uv | 174,752 × 2 = 349,504 floats | ~1.4 MB |
| indices | 43,688 × 6 = 262,128 uint16 | ~0.5 MB |

Total: ~5.9 MB pre-allocated. Reasonable for a static allocation.

---

## IDisposable

`Scene3D` and `QuadBatch` both implement `IDisposable` to release GPU resources. In TS/Three.js:
- `geometry.dispose()`, `material.dispose()`, `texture.dispose()`
- Called in a `destroy()` method (no GC finalizers needed in JS)

---

## Virtual method pattern

`DrawQuads()` is `virtual` with an empty base implementation. Subclasses (`FretPlayerScene3D`, `DrumPlayerScene3D`, etc.) override it. This maps directly to an abstract/overridable method in TS.

---

## Output files
- `ThreeCP/Scene3D.ts`
- `ThreeCP/QuadBatch.ts`
