---
name: html2canvas-quirks
description: "html2canvas rendering quirks for XR panel DOM — input elements, placeholder text, line-height"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7935a97a-5da6-407a-bf0b-0d9ffb1d32ad
---

html2canvas doesn't capture native browser rendering — it re-implements layout in JS. Form controls are the most unreliable elements to render.

**Why:** Discovered while fixing a search bar in the Library XR panel where `<input>` placeholder text was vertically clipped and off-center regardless of `line-height` or `padding` tweaks.

**How to apply:** When adding decorative form-like elements to an XR panel (which renders via html2canvas), prefer plain HTML elements over native controls.

## `<input>` text is vertically clipped

html2canvas renders `<input>` text using the browser's native control rendering, which doesn't always align with the element's computed CSS. The result is clipped or off-center text, even with explicit `line-height` and `box-sizing: border-box`.

**Fix:** Replace decorative `<input>` elements with `<div>` + `display: flex; align-items: center`. Use a `<span>` child for placeholder text styled with the muted color:

```html
<!-- ❌ BAD — clips in html2canvas -->
<input class="search-input" type="text" placeholder="Search...">

<!-- ✅ GOOD — reliable html2canvas rendering -->
<div class="search-input"><span class="search-placeholder">Search...</span></div>
```

```css
.search-input {
  display: flex;
  align-items: center;
  padding: 9px 12px;
  /* ... other styling ... */
}
.search-placeholder { color: #555555; }
```

This only applies when the field is decorative (XR panels can't accept keyboard input). If actual typing support is needed, a real `<input>` is required and the rendering difference must be accepted.

## `::placeholder` pseudo-element is not captured

html2canvas does not render `::placeholder`. If an `<input>` must be kept, set the initial value programmatically and style the input text color directly rather than relying on `::placeholder`.
