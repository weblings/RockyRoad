# Lessons Learned — v1

Gotchas from porting the XRProto visual design to the flat browser (v1) app.

---

## `BADGE_LABEL` still referenced after constant removal

**Symptom:** `Uncaught ReferenceError: BADGE_LABEL is not defined` at runtime when the library loads.

**Root cause:** `BADGE_LABEL`, `BADGE_CLASS`, and `diffBars` were removed from the constants block because they were no longer used in `refreshCards()`. But `BADGE_LABEL` was also used in `renderLibrary()` to build the `presentTypes` set (checking which instrument types exist in the library). That call site was missed.

**Fix:** Replace the `BADGE_LABEL[p.type]` guard with a check against `INSTRUMENT_TYPE` values, which is still in scope:
```ts
const knownTypes = new Set(Object.values(INSTRUMENT_TYPE).filter(Boolean));
if (knownTypes.has(p.type)) presentTypes.add(p.type);
```

**When removing a constant:** search all usages before deleting — there may be call sites outside the method you just rewrote.

---

## Custom sort dropdown trigger needs `e.stopPropagation()`

**Symptom:** Clicking the sort trigger immediately re-closes the menu (open → close in one click).

**Root cause:** The trigger click fires, toggles `open`, then the event bubbles up. If a parent listener (or the `.lib-sort-menu` click handler) also sees the event, it can re-toggle or mistakenly close.

**Fix:** Call `e.stopPropagation()` in the trigger's click handler so the event doesn't reach sibling/ancestor listeners.

---

## `text-primary`/`text-secondary` — omit `font-size` when porting to v1

**Context:** XRProto defines `.text-primary { font-size: 12px }` and `.text-secondary { font-size: 10px }` because the panel is a fixed 400×300 surface where everything is small.

**Problem:** Applying these classes to v1's splash screen `<h1>` (32px) and subtitle (15px) would silently shrink them to 12px/10px.

**Fix:** In v1, define the utility classes without `font-size` — color and weight only:
```css
.text-primary   { color: #ffffff; font-weight: 700; }
.text-secondary { color: #c8c8c8; font-weight: 400; }
```
Element-level sizes (`lib-title`, `lib-subtitle`, etc.) remain authoritative.

---

## Inter font must be explicitly loaded in the browser

**Context:** XRProto's `panel.css` declares `font-family: 'Inter', system-ui, sans-serif`. This works on Quest (Inter is available on the device) but falls through to `system-ui` in the desktop browser.

**Fix:** Add Google Fonts preconnect + stylesheet link to `index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
```
Set `font-family: 'Inter', system-ui, sans-serif` on `body` so all screens inherit it.

---

## Figma export is a body fragment — wrap it for static collaboration

**Symptom:** Exported HTML has no `<!doctype>`, `<head>`, or `<body>` — can't be opened as a standalone page.

**Fix:** Wrap the fragment in a full HTML shell with Inter font loading, a `<link>` to the companion CSS file, and `background: #000` on body so dark UI is visible. This is the standard format for static collaboration pages in this project.

---

## Figma icon colors reflect their Figma background, not the implementation background

**Symptom:** Settings gear icon exported with `color: #111111` — invisible on the `#333333` button it sits on.

**Root cause:** In Figma the icon was designed on a light surface. The exporter outputs the Figma fill color verbatim.

**Fix:** Any icon on a `primary-dark` (`#333333`) button needs `color: #ffffff`. Check all icon colors on first cleanup pass.

---

## Play/pause is circular, not a standard button

**Context:** XRProto design language makes the play/pause button visually distinct as the primary action — `border-radius: 50%`, 40×40, `#eeeeee` bg, `#111111` text. Figma exports it as a square button like everything else.

**Fix:** Always convert the play/pause button to circular on cleanup. It should stand out from the nav buttons.

---

## Custom seek track replaces native `<input type="range">`

**Context:** XRProto uses a fully custom seek bar: a `position: relative` track div containing an absolutely-positioned fill div, section tick overlay, and thumb div. Figma exports the seek as a static visual with separate sibling elements.

**Fix on cleanup:**
- Replace any `<input type="text">` or `<input type="range">` from the export with `.seek-track > .seek-fill + .seek-sections + .seek-thumb`
- Track: `#333333`, border-radius 7px, height 14px
- Fill: `#c0c0c0`, absolutely positioned from left
- Thumb: `#dadada`, 20×20 circle, `top: -3px`, z-index 1
- Ticks: `position: absolute`, `rgba(255,255,255,0.55)`, 2×10px

---

## Speed control height — use padding, not fixed height

**Symptom:** Speed `[−] [value] [+]` control is shorter than adjacent buttons even though they look aligned in Figma.

**Root cause:** Figma exports the speed buttons with a fixed pixel height (e.g. `height: 22px`). The settings/back buttons size from padding + content, ending up taller.

**Fix:** Remove `height` from speed buttons; use `padding: 8px 0` (matching the vertical padding of sibling buttons) so all controls reach the same natural height.

---

## Custom seek drag requires `setPointerCapture`

**Symptom:** Seek thumb "loses" the drag if the pointer moves fast and leaves the track element — `pointermove` and `pointerup` stop firing.

**Root cause:** Without pointer capture, events are delivered to whichever element is under the pointer. The thumb/track are small — fast drags overshoot them instantly.

**Fix:** Call `seekTrack.setPointerCapture(e.pointerId)` inside the `pointerdown` handler. All subsequent `pointermove` / `pointerup` events will be routed to `seekTrack` regardless of pointer position, for the lifetime of that gesture.

```ts
seekTrack.addEventListener('pointerdown', e => {
    isScrubbing = true;
    seekTrack.setPointerCapture(e.pointerId);
    setScrubPos(getPct(e));
});
seekTrack.addEventListener('pointermove', e => { if (isScrubbing) setScrubPos(getPct(e)); });
seekTrack.addEventListener('pointerup',   e => { if (isScrubbing) { /* commit */ isScrubbing = false; } });
```

---

## Icon+text button gap is `6px` in v1

**Context:** All nav/action buttons that combine an inline SVG icon with a text label (back, settings, tune, etc.) use `gap: 6px` in the v1 design system.

**Fix:** Always set `gap: 6px` on icon+text flex buttons. The tempting round number `gap: 8px` is visually too wide — it was used mistakenly on the Tune button and corrected.

---

## XRProto `.icon-btn` centering fudge is class-scoped — does NOT apply to play button

**Context:** `panel.css` defines:
```css
.xr-panel .button.icon-btn > svg { display: block; flex-shrink: 0; margin-left: -2px; }
.xr-panel .button.icon-btn > span { position: relative; top: -0.5px; }
```
This can look like a global adjustment that all buttons need.

**Reality:** The circular play/pause button is not an `.icon-btn`. It contains a single unicode glyph, uses plain `display: flex; align-items: center; justify-content: center`, and needs no offsets. Same in v1's `.active-play-btn`. The fudge only compensates for SVG optical alignment in icon+text rows.

---

## `SongPlayer.play()` must work as a pure clock even without audio

**Symptom:** Songs without `song.ogg` throw "File not found" and abort, rather than playing silently.

**Root cause:** V1's original `play()` guarded on `if (!this.context || !this.buffer || this._playing) return` — if no buffer was ever loaded, `play()` was a no-op and the scene clock never advanced.

**Fix:** Match XRProto's version — guard only on `this._playing`, then create an `AudioContext` unconditionally (`if (!this.context) this.context = new AudioContext()`), and only wire the `AudioBufferSourceNode` if `this.buffer` exists. The audio context's `currentTime` then serves as the clock regardless of whether audio loaded.

---

## `getKeyPosition` must use absolute chromatic position (`key % 12`), not relative (`(key - minKey) % 12`)

**Symptom:** In 88-key mode (`minKey = 21 = A0`), white key lane dividers and note trails are shifted — keys after the first B appear one position too far right.

**Root cause:** `(key - minKey) % 12` gives the semitone offset *within the range*, which is only correct when `minKey` is itself a C (a multiple of 12, e.g. 48). For minKey=21, the layout repeats from the wrong chromatic starting point.

**Fix:** Use `key % 12` for `SCALE_WHITE_BLACK` and `SCALE_OFFSETS` lookups, computing the absolute white-key offset from C0 and subtracting the minKey offset: `(absOffset(key) - absOffset(minKey)) * 8`.

---

## `camera.setLookAt()` degenerates when looking straight down

**Symptom:** Top-down camera produces a black screen or mangled view — the scene disappears when `topDown = true`.

**Root cause:** `setLookAt` internally computes a right vector via cross product of forward and up. When forward is `(0,-1,0)` (straight down) and up is `(0,1,0)`, the cross product is zero — degenerate matrix.

**Fix:** Bypass the wrapper and set `threeCamera` directly: `cam.up.set(0, 0, -1)` (puts future notes at the top), then `cam.lookAt(x, 0, z)`. This gives Three.js the non-degenerate up vector it needs.

---

## Check Project's version of a scene class before using v1's

**Context:** `ThreeCP/Project/src/` is further along than `ThreeCP/v1/src/` for Keys. This session found Project's `KeysPlayerScene3D` had four things v1's was missing: top-down camera mode (`topDown` toggle), piano image mesh (`syncPianoMesh` + `piano.png`), per-hand note coloring, and the `key % 12` layout fix.

**Rule:** Before working on a v1 scene class, check if a newer version exists in `ThreeCP/Project/src/` — if so, port it rather than building on the stale v1 base.

---

## Static export page needs `width: 100vw`, not Figma's artboard pixel width

**Symptom:** Seek bar doesn't fill the screen — the overlay is capped at the Figma artboard width (e.g. `1000px`).

**Fix:** Change the root overlay from `width: 1000px` to `width: 100vw` on cleanup. The seek wrap already has `flex: 1` so it expands automatically once the container is full-width.
