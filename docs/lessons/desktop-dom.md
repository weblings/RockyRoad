# Desktop DOM/CSS

Id: lesson-desktop-dom

Browser-native DOM/CSS/event gotchas from building this project's own desktop screens and shared
components (`src/desktop/`) — not XR/uikit (see `ui-toolkit/`), not IWSDK/Three.js (see `engine/`).
See [`README.md`](README.md) for how entries get routed here vs. elsewhere.

---

## A CSS child-combinator selector has to match where a component actually inserts itself, not where it's called from
Tags: css, selectors, flexbox, dropdown, components
Applies-when: writing a > selector against a reusable component's root class

**Symptom:** Two dropdowns meant to split a row evenly via `.dropdown-row > .dropdown { flex: 1 1 0 }`
stayed content-hugging and left-packed, with dead space on the right — never centered or split.

**Root cause:** The `Dropdown` class appends its own root element into whatever `container` it's
given — the caller passed a *slot* div as that container, not `.dropdown-row` itself. So `.dropdown`
ended up a grandchild of `.dropdown-row`, one level deeper than `>` could reach; the selector
silently matched nothing, and `.dropdown`'s own base rule (`flex: 0 0 auto`) won by default.

**Fix:** Size the actual DOM structure a component inserts into, not the structure implied by the
call site's indentation — put the sizing class on the slot div itself (the real direct child), and
let the component fill it via normal block layout.

**How to avoid next time:** When a reusable component owns "append myself into this container"
construction, check what it actually nests before writing a `>`-combinator rule against its own
top-level class — inspect the real resulting DOM, don't assume from the caller's markup shape.

---

## A hidden flex item still claims its share of the row unless its wrapper is hidden too
Tags: css, flexbox, display-none, layout
Applies-when: conditionally hiding one item in a flex row

**Symptom:** Two dropdowns share a row via `flex: 1 1 0` each. Hiding one (no alternative instrument,
or no available difficulties) left the other pinned to its original half instead of filling the row.

**Root cause:** `display: none` on the dropdown itself doesn't touch its *slot* wrapper — the slot is
a separate, always-present element, and an invisible box with `flex: 1 1 0` still fully participates
in flex layout, claiming half the row's width with nothing visible inside it.

**Fix:** Collapse the slot itself (`display: none`), not just the component inside it, whenever the
component is conditionally absent — only then does the remaining sibling's `flex-grow` have room to
actually fill the freed space.

---

## `stopPropagation()` on a popover trigger silently splits "close on outside click" and "close sibling popovers" into two unrelated problems
Tags: events, popover, dropdown, stopPropagation, outside-click
Applies-when: implementing close-on-outside-click or close-sibling-popovers

**Finding:** Removing `stopPropagation()` from a popover trigger's own click handler lets that click
bubble to a single `document`-level listener, which then handles *both* "click elsewhere closes this"
and "opening one popover closes any other that's open" with one containment check
(`!dropdown.root.contains(e.target)`) — no separate sibling-closing method needed. This works because
a listener attached directly to an element always fires before any bubble-phase ancestor listener
(including one on `document`), so by the time the document-level check runs, the just-opened
popover's own state is already up to date and correctly excluded by the containment check.

**How to apply:** Before reaching for a separate "close my siblings" method on a popover/dropdown
component, check whether an accidental `stopPropagation()` is blocking a much simpler unified
document-listener solution — the fix can be to *remove* code, not add more. Requires a **bubble-phase**
listener specifically; capture phase would see stale state, since it runs before the target's own
handler.

---

## A fixed `grid-template-columns: repeat(N, ...)` doesn't wrap until item count exceeds N — with few items it just looks like one row, not a grid
Tags: css, grid, library, responsive
Applies-when: a CSS grid renders as a single row or column count looks wrong

**Symptom:** The library's song grid rendered as what looked like a single horizontal row instead
of a multi-row grid.

**Root cause:** `.lib-song-list` was `repeat(9, 1fr)`, but the bundled demo library only has 4
songs. CSS Grid only wraps into a second row once you exceed the declared column count — with fewer
items than columns, there's no wrapping to ever make it read as a grid, regardless of how correct
the `display: grid` declaration is. The actual regression was a stale code comment ("3-column")
sitting next to code that said 9 — a good sign to diff comment against code when something looks
subtly wrong rather than trust either alone.

**Fix:** Switched to `repeat(auto-fill, minmax(260px, 1fr))` so column count scales with actual
available width instead of a hardcoded number tuned for a different (or no longer accurate) item
count.

---

## Prefer an element's own `margin` over a shared flex `gap` when the goal is "always this much space above me," not "space between every visible pair"
Tags: css, flexbox, gap, margin, spacing
Applies-when: adding consistent space above one element in a flex container with conditionally hidden siblings

**Symptom:** Doubling a flex container's `gap` to add visible space above one specific button had no
effect for some songs.

**Root cause:** `gap` only applies *between* visible flex items — when a preceding sibling is
conditionally `display: none` (a Tune button hidden for non-tunable instruments), the gap that
sibling would have contributed collapses to zero, silently undoing the intended spacing for every
state where that sibling happens to be absent.

**Fix:** Give the specific element its own `margin`, decoupled from whichever siblings happen to be
visible, whenever "this element should have consistent space above it" is really about that one
element — not a general "space between every item in this row" rule that only happens to look right
when every item is present.

---

## Porting an XR button's size to desktop: keep the ratio and radius proportion, not the unit
Tags: css, sizing, aspect-ratio, border-radius, xr-parity
Applies-when: matching a desktop control's size or shape to its uikitml counterpart

XR sizes are in panel units (a 15 x 3.6 button on a 40-unit panel). A viewport-scaled unit made the
desktop buttons huge, since a desktop column is a fixed ~312px, not a fraction of a panel. Reusing
XR's radius in pixels after shrinking also read as too round: 10px on a ~36px-tall button, where XR's
0.5 / 3.6 is about 14% of the height.

**How to apply:** size against the container (`width: calc(50% - 4px)` plus `aspect-ratio: 15 / 3.6`)
so the row lines up with sibling controls, and pick a radius from the same-size neighbors
(`.pre-back` uses 6px) instead of carrying over the old value.

Even XR's `panel.css` pixel values (12px text, 5px radius) are world-space scaled, so copying them
verbatim made desktop buttons look small (RockyRoad-4bi.5). Take XR's colors and roles, size in
desktop px.

---

## A custom range-input thumb forces a full rebuild of the track, including the fill
Tags: css, range-input, slider, accent-color, webkit
Applies-when: restyling an `<input type="range">` beyond `accent-color`, e.g. a white thumb

Chrome only honors a `::-webkit-slider-thumb` override once `appearance: none` is set, and that also
turns off `accent-color`'s filled-track rendering. WebKit has no filled-track pseudo-element (Firefox
has `::-moz-range-progress`), so the fill disappears unless it is rebuilt by hand.

**Fix:** paint the track as a hard-stop `linear-gradient` driven by a `--slider-percent` variable,
set from JS on mount and on every `input` event. Offset the WebKit thumb with `margin-top` too.

---

## Changing text inside a centered flex row needs a fixed-width slot
Tags: css, flexbox, layout-shift, tabular-nums, centering
Applies-when: a live-updating value (slider readout, counter) sits in a centered row

A readout with only `min-width` grows as the value gains digits (`9×` to `12.5×`), and a
`justify-content: center` row re-centers around it, so every control in the row shifts while
dragging.

**Fix:** give the readout an explicit `width` sized for the longest value, `text-align: right`, and
`font-variant-numeric: tabular-nums` so digit widths don't jitter either.

---

## 2D canvas drawing state leaks between draws unless each helper saves and restores it
Tags: canvas, state, linecap, dash, alpha
Applies-when: adding a canvas draw helper that sets lineCap, lineDash, globalAlpha or transforms

`drawCheck` set `lineCap = 'round'`, and every later `stroke()` in the frame silently inherited it,
rounding the ends of a dashed progress outline that was meant to end square. `setLineDash` and
`globalAlpha` leak the same way.

**Fix:** wrap each helper in `ctx.save()` / `ctx.restore()`, and set the properties a draw depends
on explicitly rather than assuming the defaults.

---

## A shared `.btn` base only wins over screen rules that come before it
Tags: css, cascade, shared-classes, specificity, inline-flex
Applies-when: migrating per-screen buttons onto shared `.btn`/`.btn-dark`/`.btn-light` classes

Single-class selectors tie on specificity, so a screen rule that sets `padding` or `font-size` only
overrides the shared class if it appears later in the stylesheet. `.btn` is `inline-flex`, so a
full-width button (`#settings-close`) needs `display: flex` to sit on its own line at `width: 100%`.

**How to apply:** keep the shared block at the top of `desktop.html`'s `<style>`, leave only layout
(position, width, margins) in the screen classes, and set any deliberate size override there.
Remove the old color/size declarations rather than overriding them, and grep `src/` for the class
before deleting it (`.lib-btn-primary` had no users).

---

## Reveal a stroked shape with a clip rect, not dash tricks
Tags: canvas, animation, clip, setLineDash, wipe
Applies-when: animating a canvas outline or path in from one end

A rounded-rect outline filled with `setLineDash` on the near edge plus a fading alpha pass for the
caps and far edge was fiddly (side tracking, two passes) and read as jumpy. Stroking the full
`roundRect` once and clipping to a rect that grows from one end gives a clean wipe in a few lines.

**How to apply:** `save()`, `rect()` + `clip()` sized by progress, stroke the whole shape, `restore()`.

---

## An absolute nav bar keeps flex-centered content centered on the whole screen
Tags: css, flex, centering, layout, nav-bar
Applies-when: adding a top bar to a screen whose body uses `align-items: center`

A new in-flow `.tuner-nav-bar` took ~66px, so `.tuner-body` centered the controls and canvas in the
space below it and the page looked pushed down. Making the bar `position: absolute` restores centering
on the full screen, at the cost of possible overlap on very short windows.

---

## Draw an SVG icon on canvas with `Path2D`, and center asymmetric icons optically
Tags: canvas, svg, path2d, icons, centering
Applies-when: replacing a hand-stroked canvas glyph with a shared icon, or aligning an icon to text

`new Path2D(d)` takes the `d` attribute of a `public/*.svg` icon directly, so the canvas and the DOM can
share one shape: `translate`, `scale` (32-unit box to the target size), `fill`. A check's bounding box
is centered but its mass sits low, so it looked lower than the label beside it.

**How to apply:** nudge by about 1px per 16px of icon rather than trusting the bbox, and view it next to the text.


---

## `cqh` font sizing needs `container-type: size`, which stops the box sizing from its content
Tags: css, container-queries, cqh, sizing, fit-text
Applies-when: sizing text to its box's height with container query units

`font-size: 42cqh` on the tuner label only works once the box has `container-type: size`. A size
container ignores its children when sizing, so the box needs an explicit height (here from the fixed
`.tuner-boxes` height) or it collapses to zero and the text goes with it.

**How to apply:** set the height on the container first, then use `cqh`. Resize-driven layouts (4bi.9) must set it too.

---

## Clamp a label that tracks a moving marker with `left: p%` plus `translateX(-p%)`
Tags: css, positioning, clamp, label, transform
Applies-when: a text label follows a marker along a track and must stay inside the track's ends

Placing the label at `left: p%` and shifting it by `translateX(-p%)` of its own width left-justifies
it at 0% and right-justifies it at 100%, with a smooth slide between. No measuring or JS clamp needed,
and the tuner's `Flat`/`Sharp` text justifies itself because the needle is pinned at the ends.

**How to apply:** put marker and label in one lane whose x range equals the track's, so both share the same percentages.

---

## Wipe a DOM border with `clip-path: inset()` on a white duplicate, not with gradients
Tags: css, clip-path, border, wipe, animation
Applies-when: revealing an outline from a point outward, such as lock feedback on a bordered box

Stack a white-bordered copy over the colored border and animate `clip-path: inset(0 R% 0 L%)`. For a
wipe from x spreading both ways, `L = x * (1 - p)` and `R = 100 - (x + (100 - x) * p)`. At `p = 1` both
are 0 and the sides are revealed last. Hide it with `inset(0 100% 0 100%)`.

**How to apply:** compute the insets per frame from the shared dwell progress, the same input the canvas version uses.
