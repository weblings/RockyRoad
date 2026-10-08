# Desktop DOM/CSS

Browser-native DOM/CSS/event gotchas from building this project's own desktop screens and shared
components (`src/desktop/`) — not XR/uikit (see `ui-toolkit/`), not IWSDK/Three.js (see `engine/`).
See [`README.md`](README.md) for how entries get routed here vs. elsewhere.

---

## A CSS child-combinator selector has to match where a component actually inserts itself, not where it's called from

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
