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
