---
name: xr-panel-hover-states
description: "How to implement hover/active visual states on XR panel buttons (DOM class + 10fps render passthrough, no invalidation needed)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7935a97a-5da6-407a-bf0b-0d9ffb1d32ad
---

In XR, CSS `:hover` and `:active` never fire (no mouse). To get hover feedback on panel buttons rendered via html2canvas:

**Why:** XRProto renders the panel DOM to a CanvasTexture at ~10fps via html2canvas. Since the render fires on a timer regardless, DOM class changes are picked up automatically — no explicit invalidation needed.

**How to apply:**

## The core pattern

Every frame, raycast against the panel mesh and find which `XrButton` element is under the UV hit. Toggle a `.xr-hover` class on that element:

```typescript
private hoveredBtn: XrButton | null = null;

// In update() — runs every frame, O(n buttons):
let newHovered: XrButton | null = null;
hoverOuter: for (const { ray } of hands) {
    // ... raycast, get pixX/pixY ...
    for (const btn of xrButtons) {
        const r = btn.el.getBoundingClientRect();
        if (/* pixX/Y inside bounds */) { newHovered = btn; break hoverOuter; }
    }
    break; // first hand that hits the panel wins
}
if (newHovered !== this.hoveredBtn) {
    this.hoveredBtn?.el.classList.remove('xr-hover');
    newHovered?.el.classList.add('xr-hover');
    this.hoveredBtn = newHovered;
}
```

Do NOT call `invalidatePanelRender` — the 10fps tick picks up the class change for free.

## CSS

Add `.xr-hover` alongside `:hover` in every interactive rule:

```css
.button.primary-dark:hover, .button.primary-dark.xr-hover { background: #515151; }
```

For elements not in the `.button` class system (e.g. `.play-btn`, `.seek-track`, `.color-swatch`), add equivalent `.xr-hover` rules alongside their `:hover` rules.

## clearXrButtons MUST strip .xr-hover

When navigating between screens, the old button elements are discarded. If `.xr-hover` is not removed before clearing, the class persists on a detached DOM node and `hoveredBtn` points to a stale element.

```typescript
function clearXrButtons(): void {
    for (const btn of xrButtons) btn.el.classList.remove('xr-hover');
    xrButtons.length = 0;
}
```

`hoveredBtn` is self-healing: on the next frame, `xrButtons` is empty so `newHovered` is null, which clears the stale reference.

## Active (click) states

`.xr-active` is NOT worth implementing — `onClick` fires and `rerender()` rebuilds the entire HTML faster than one 100ms render cycle. The button may not exist by the time the next html2canvas runs.

## Seek-thumb note

The seek-thumb is a visual-only div (not in `xrButtons`), so it never gets `.xr-hover` independently. The seek-track hover rule covers the whole track area including the thumb region — no `:has()` exclusion needed for the XR case.
