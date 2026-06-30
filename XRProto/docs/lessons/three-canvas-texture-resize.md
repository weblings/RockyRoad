---
name: three-canvas-texture-resize
description: THREE.js CanvasTexture GPU resize bug — must call dispose() before changing canvas dimensions
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7935a97a-5da6-407a-bf0b-0d9ffb1d32ad
---

When the HTML canvas backing a `CanvasTexture` has its dimensions changed (`canvas.width = w`), THREE.js calls `texSubImage2D` (not `texImage2D`) on the existing WebGL texture. This patches pixels in-place but cannot change the GPU texture's allocated dimensions. The old texture stays at its original size; new content only fills a portion of it, leaving old pixels visible in the remainder.

**Why:** Hit this in XRProto when resizing the panel from Library (1000×525) to Song (400×300). The 1000×525 GPU texture stayed alive — Song content filled only the top-left 400×300 pixels, and the rest showed stale Library content on the mesh.

**How to apply:** Any time canvas dimensions change for a live CanvasTexture, always:
```typescript
canvas.width  = newW;  // also clears the canvas
canvas.height = newH;
texture.dispose();       // deletes the GPU texture — forces texImage2D on next render
texture.needsUpdate = true;
```
`dispose()` removes the WebGL handle from THREE.js's internal cache. The next render re-allocates via `texImage2D` at the canvas's current dimensions. Without `dispose()`, `needsUpdate` alone is not enough.

## Corollary: skip dispose when dimensions are unchanged

Clearing the canvas and calling `dispose()` when size hasn't changed causes an unnecessary blank frame — the old content vanishes immediately while the async re-render takes ~100ms to complete. Guard the resize block with a size check:

```typescript
if (canvas.width !== newW || canvas.height !== newH) {
    canvas.width  = newW;
    canvas.height = newH;
    texture.dispose();
    texture.needsUpdate = true;
    // ... rebuild geometry etc.
}
// Always cancel in-flight async renders regardless of size change.
invalidatePanelRender();
```

Same-size transitions (e.g. Song → Settings) then show old content while html2canvas re-renders instead of going blank. Size-changing transitions (e.g. Library 1000×525 → Song 400×300) still flash blank briefly — unavoidable with this architecture.
