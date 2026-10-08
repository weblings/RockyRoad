# uikit/uikitml — text rendering

Font/glyph/text-layout gotchas. See [`INDEX.md`](INDEX.md) for the full ui-toolkit map. The
custom on-screen-keyboard follow-up (Library's search box has no reachable OS keyboard in an
active WebXR session) is tracked in project memory (`project_xr_uikit_investigation.md`), not
here — it's an open task, not a retrospective lesson.

---

## Font: `inter` works with zero setup, but only in specific weights

**Finding:** `@pmndrs/uikit`'s built-in default font family (used automatically when no
`fontFamilies` config is supplied at all) is `inter`, lazy-loaded from `@pmndrs/msdfonts`
(already a project dependency) — confirmed in `node_modules/@pmndrs/uikit/dist/text/font.js`.
Zero pipeline work needed. However, only four weights are available: `light`(300), `medium`(500),
`semi-bold`(600), `bold`(700) — there's no plain `normal`/400. Pick `medium` as the default body
text weight.

---

## A burst of brand-new text on one element can corrupt an unrelated element's layout elsewhere in the same document

An unrelated, unchanged element (different subtree) rendered at the wrong size — only when a
larger/text-heavy section elsewhere in the doc became visible. Confirmed via `element.size.value`
(a public signal, see `component.js`) that a static element's own measured size changed
(`[5.5, 2.5]` → `[39, 1.6]`) with no CSS/markup change of its own.

**Best working theory:** `inter` glyphs lazy-load per-character on first render (`@pmndrs/msdfonts`).
A burst of many never-before-rendered characters triggers concurrent async remeasures; Yoga's
`calculateLayout()` isn't safe against this overlap and can scribble a wrong size into an unrelated
node. Confirmed by removing the filler text — both this and a related scroll-range corruption
disappeared immediately.

**How to avoid:** don't dump a large amount of brand-new text into a doc all at once (watch for this
with Library's unbounded song list). **Diagnosing:** no thrown error — log `element.size.value` a few
hundred ms after the change (layout settles async) and compare working vs. broken. **Repro is flaky
across reloads** — the glyph/font-atlas cache from earlier in the session can mask it; confirm fixes
with a genuinely cold browser start, more than once.

---

## Missing-glyph character set keeps growing — assume any non-ASCII typographic character is unsupported until tested

**Finding:** confirmed missing from uikit's pre-built Inter MSDF glyph subset so far: `‹`, `−`
(minus sign, U+2212, not a hyphen), `×` (multiplication sign, U+00D7, not the letter x) — renders
as a missing-glyph tofu/placeholder box, not an error. Preemptively also swapped out `…`
(horizontal ellipsis, U+2026) for three literal ASCII periods before it could cause the same
symptom, on the assumption that "special typographic character, not present in a hand-picked
pre-built glyph subset" is the general risk category, not something specific to those three
already-discovered characters.

**How to apply:** default to plain ASCII substitutes for anything that isn't a letter/digit/basic
punctuation the first time you write text content for a `.uikitml` screen (`x` not `×`, `-` not
`−`, `...` not `…`), rather than writing the "correct" typographic character and finding out via a
white-square bug report. If a genuinely special character is needed and no ASCII substitute reads
naturally, test it deliberately before shipping rather than assuming it's covered.

---

## An element authored with no static text content never becomes updatable via `setProperties({ text })`

An empty `<span id="x"></span>` (meant to be filled at runtime) stays permanently blank —
`setProperties({ text })` never throws, just does nothing. Cause: `<span>text</span>` compiles to a
`Container` plus a synthesized child `Text` node derived from the literal string in `children` at
compile time (`uikitml/interpreter/index.js`). Empty `children` → no child Text node → nothing for
`setProperties` to update.

**Fix:** every text element ever updated via `setProperties` needs real placeholder text authored
in the `.uikitml` source — not optional. Grep new files for `<span[^>]*></span>`/`<p[^>]*></p>`
before shipping.

---

## Splitting a multi-styled string into independently-styled elements is just two spans, each needing its own placeholder text

A single Text node can't mix font-weight/size mid-string the way inline `<b>` could in the original
HTML source it was translated from. Two sibling spans in a flex-column wrapper (with `gap-row` for
the spacing between them), each with its own class and its own real placeholder text (see the
entry above), is the straightforward replacement — no special mechanism needed beyond that.

---

## `whiteSpace` does not control line-wrapping in this library — only `wordBreak` against available width does

A one-line label ("Speed: 20%") wrapped inside a comfortably-wide container; `white-space: nowrap`
made no difference. Two stacked bugs: `nowrap` isn't a valid value in this schema at all
(`properties/schema.js` only allows `normal/collapse/pre/pre-line`, silently falls back to
default), and more fundamentally, no `whiteSpace` value controls wrapping — it only governs
whitespace collapsing (`text/layout/normalize.js`); the actual line-break is `wordBreak` vs.
available width, in `measure.js`.

**Fix:** don't reach for `whiteSpace` for a wrapping problem — give the container real, sufficient
width instead, calibrated against an already-working element at the same scale rather than guessed.

---

## Even a wide-enough container didn't fully fix the wrap — an unresolved, likely cross-subtree Yoga corruption

**Status: unresolved, shelved.** Speed dropdown trigger's label intermittently renders as broken
across two lines even with sufficient width — measured height stays constant, ruling out a real
wrap and pointing at a rendering-level glyph artifact instead. "200%" repros every time; shorter
labels repro intermittently, correlated with opening/dragging the dropdown.

**Leading theory, not proven:** same class as "A burst of brand-new text..." above — `.option-menu`'s
ten items are `display:none` until first opened, and Yoga skips measuring `display:none` subtrees
(`flex/node.js`), so first open bursts all ten measurements at once, plausibly corrupting the
trigger label elsewhere in the doc (confirmed `.size` reads `[0,0]` at the exact flip moment).

**Tried, none fully resolved it:** recreating the trigger's Text node on every change (measurably
better, not eliminated); forcing the burst at mount time instead of first open (no improvement,
and untestable fully-hidden since the panel is already visible by then); throttling drag writes to
one per rAF (broke scrolling, reverted, didn't fix the wrap either).

**Not attempted — shelved as too costly for a visual bug:** moving the trigger into a separate
`PanelUI` document, which would structurally guarantee isolation (every `PanelUI` has its own Yoga
tree; this app currently has exactly one `PanelUI` per screen, five total).
