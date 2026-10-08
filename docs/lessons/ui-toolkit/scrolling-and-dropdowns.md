# uikit/uikitml — scrolling and dropdowns

`overflow: scroll` and dropdown-menu gotchas. See [`INDEX.md`](INDEX.md) for the full ui-toolkit
map.

---

## `overflow: scroll` alone isn't enough — children need `flex-shrink: 0`, and the scrollbar needs explicit width/color

**Symptom 1:** `overflow: scroll` on a fixed-height container with overflowing content compresses
the content to fit instead of scrolling. **Root cause:** unlike real CSS, this Yoga port doesn't
reset a scroll child's min-size to 0 — Yoga's normal `flex-shrink: 1` still compresses children
before `overflow` gets a chance to matter (`flex/node.js`'s `updateMeasurements()`). **Fix:** give
the scroll container's direct children `flex-shrink: 0`.

**Symptom 2:** First scrollbar appearance renders as a large pale bar. **Root cause:** default
`scrollbarWidth` is `10` — same raw unit scale as everything else (`properties/defaults.js`), not a
sane pixel default, and there's no default `scrollbarColor`. **Fix:** always set both explicitly,
e.g. `scrollbar-width: 0.3; scrollbar-color: #4a4a4a;`.

---

## `overflow: hidden` did not visibly clip an absolutely-positioned sibling's children the way expected — unresolved, reverted

**Symptom:** Tried wrapping a track's fill-bar + dynamically-placed tick marks in a separate
`overflow: hidden` container (matching the track's own `border-radius`) so ticks landing near
either end would crop to the track's rounded shape instead of poking out past the curve, with the
track's thumb kept as an unclipped sibling outside that wrapper (so it could still overhang the
top edge). In-headset, this did not produce the expected clipping — reverted.

**Status:** not root-caused. Didn't get to dig into *why* before reverting (the wrapper approach
was replaced with a pragmatic percentage-based skip — don't generate a tick within the first/last
~3% of the track's width at all — see `_buildSectionTicks()` in `XRActiveScene.ts`). Worth
investigating properly before relying on `overflow: hidden` for clipping purposes elsewhere (e.g.
Library thumbnails, any rounded-corner container with absolutely-positioned children) — possible
angles for next time: whether `overflow: hidden` needs the clipped children to be genuine
*layout* children (not just visually-nested via absolute positioning) to participate in uikit's
clipping-rect system, or whether `.clippingRect` (seen referenced in `container.js`) needs some
additional setup this simple markup-only approach didn't provide.

---

## `overflow: scroll` + `flex-wrap: wrap` on the same element works

Confirmed in-headset for Library's song grid: one element is both the wrapping grid *and* the
scrollable viewport (same single-element shape as Settings' `.body`), rather than a separate
viewport/inner split. No separate scroll-track markup needed, matching every other
`overflow: scroll` container in this app.

---

## `overflow: scroll`'s pointer capture and release check different objects, wedging capture on any drag that starts on a child

A scrollable popover (Play HUD's Speed dropdown) worked once, then never scrolled again. Cause:
`scroll.js`'s `onPointerDown` captures on `event.object` (the deepest-hit child, per
`pointer-events/event.js`), but `onPointerFinish` releases via the *container* — mismatch silently
no-ops and wedges capture on that child forever. Any drag starting on a child (not empty gutter
space) hits this; at this popover's small size, buttons cover nearly the whole surface.

**Fix:** don't use `overflow: scroll` when clickable children cover most of the surface — roll a
custom drag (`container.worldToLocal`, like `_wireSeekDrag`) with a `pressed`/`dragging` gate, and
**defer `setPointerCapture` until real drag distance is confirmed**. Capturing eagerly on every
`pointerdown` breaks native click synthesis (`pointer.js`'s `getIsClicked()` requires down/up to hit
the same object) and silently kills every child's `onClick`.

---

## A dropdown needing both a fixed and a variable-length option list splits into two methods sharing one private tail

**Finding:** `OptionDropdown` (the shared XR dropdown class) needs two shapes: `render()` for
options already declared in markup with known ids (Speed's fixed 10), and `renderDynamic()` for a
count/labels that vary per instance (Difficulty's per-song list) — creating/destroying
`UIKit.Container`+`Text` nodes each call, same pattern as `_buildSectionTicks`/Library's rows.
Both funnel into one shared private tail (trigger/chevron toggle, centering math, scroll wiring)
that doesn't care how the option elements were obtained — only the "how do we get the elements"
step differs.

---

## An analytic viewport-height fix for a dropdown's last-item-clipped scroll bug didn't work — unresolved

**Symptom:** Selecting the last option in a dropdown doesn't scroll it into the visible window;
earlier/near-last options work fine.

**Attempted fix (reverted):** Assumed `computeCenteredOffset()`'s `menuHeight` (mirroring
`.option-menu`'s CSS `height`) overstated the real clipped viewport by the element's padding/border,
under-clamping the max scroll offset. Reducing `menuHeight` to compensate had no observed effect —
root cause is still unconfirmed. Don't re-attempt the same padding-subtraction theory without new
evidence.

---

## A runtime-created option node doesn't inherit a `<button>` markup class's default alignment

Reusing `.option-item` (authored against a `<button>` in markup) on a dynamically-created
`UIKit.Container` (`OptionDropdown.renderDynamic()`) left its text left-justified instead of
centered — the button's implicit center-alignment isn't part of the shared class, only the button
element itself. Fix: set `justifyContent`/`alignItems: 'center'` explicitly on the container.

---

## A click's `event.object` can go stale mid-bubble if a handler's own `rerender()` destroys/recreates that exact node

**Symptom:** An outside-click/sibling-close listener on `doc.rootElement` (bubble-phase, mirroring
desktop's `Dropdown` — see `ThreeCP/Analysis/lessons/desktop-dom.md`) worked reliably when opening
a trigger via its chevron icon, but clicking the trigger's *label text* sometimes immediately
re-closed the dropdown it had just opened.

**Root cause:** The trigger's `onClick` toggles `menuOpen` and calls `rerender()` *synchronously*,
before the click event finishes bubbling up to root. `rerender()` re-runs `setTriggerLabel()`,
which unconditionally destroys and recreates the label's `Text` node every call (deliberate — see
the next entry down for why). If the click landed on that label, `slot.remove(node)` nulls the
node's `.parent` mid-bubble — so by the time the root listener's `doc.isDescendantOf(target,
trigger)` containment check runs, `target`'s parent chain is already severed and reads as
"outside," closing the dropdown it just opened. The chevron icons are static (`display`-toggled
only, never destroyed), so clicking them never hit this.

**Fix:** don't trust a click's original target's *identity* to survive past a handler that might
destructively rerender that very node. A trigger click is definitionally "inside" its own
dropdown — added a one-shot `justOpenedByOwnClick` flag, set the instant the trigger's own
`onClick` opens it (before calling `rerender()`), consumed first thing in the outside-click check
to skip the now-unreliable identity check entirely for that click.

**How to avoid next time:** before wiring any check against a `PointerEvent`'s `object`/`target`
that runs *after* another handler for the same event may have already fired (bubble phase, by
definition), ask whether that earlier handler's own side effects (destroy+recreate patterns
especially) could invalidate the very node being checked.
