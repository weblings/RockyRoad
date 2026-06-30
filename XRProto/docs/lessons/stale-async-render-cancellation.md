---
name: stale-async-render-cancellation
description: Generation counter pattern for cancelling stale async renders (html2canvas / any async capture)
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7935a97a-5da6-407a-bf0b-0d9ffb1d32ad
---

When an async render (e.g. html2canvas) is in-flight and a screen transition happens before it resolves, the Promise callback can write stale content into the canvas and corrupt the new screen.

**Why:** In XRProto, html2canvas runs at ~10fps. A Library render in flight would complete after switching to the Song screen, briefly writing Library pixels into the Song panel.

**How to apply:** Use a generation counter to discard stale resolves:

```typescript
// On the system/renderer:
private renderGen = 0;

// Expose an invalidation hook (call this on screen transitions):
world.globals.invalidateRender = (): void => {
    this.renderGen++;
    this.renderPending = false;
    this.lastRenderTime = -999; // skip throttle on next frame
};

// In the render loop:
const captureGen = this.renderGen;
html2canvas(el, ...).then(canvas => {
    if (this.renderGen !== captureGen) {
        this.renderPending = false;
        return; // stale — discard
    }
    // ... write to canvas
});
```

Call `invalidateRender()` (via globals) from any screen-transition function. Combined with [[three-canvas-texture-resize]] (dispose + needsUpdate), this prevents both GPU texture size staleness and canvas pixel staleness.
