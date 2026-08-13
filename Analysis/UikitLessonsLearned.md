# uikit / uikitml Lessons Learned

Gotchas specific to the `PanelUI`/`@pmndrs/uikit`/`.uikitml` migration (see `WebXR_IWSDK.md`
Phase 7 and `ImplementationPlan.md` for the migration itself). Split out from the main
`LessonsLearned.md` since this is a large, self-contained topic — see that file's pointer entry.

---

## `.uikitml` has no CSS shorthand — and using it fails silently, far from the error

`@pmndrs/uikit`'s schema has no combined `padding`/`margin`/`gap`, only the directional forms
(`padding-top`, `gap-row`, etc). The compiler doesn't validate this — `padding: 1 1 0 1;` compiles
straight through and only fails later at runtime, deep inside `interpret()`, far from the source line.

**Fix:** always write out directional properties individually, never shorthand (single-value included
— see the later correction entry). Before shipping, grep compiled `public/ui/*.json` for bare
`"padding":`/`"margin":`/`"gap":` keys.

---

## Every flex container needs explicit `display: flex` + `flex-direction` — nothing is inherited

**Symptom:** Content renders scrunched into a single horizontal row that scrolls sideways, when
it should stack vertically.

**Root cause:** A `<div>` (or any container) with no `class` — or a class that doesn't set
`display`/`flex-direction` — does not inherit layout behavior from anywhere. It's very easy to
add a purely structural wrapper `<div id="...">` (e.g. for a runtime `display:none`/`flex`
toggle) and forget it also needs its own layout properties, since in real CSS a bare `<div>` at
least stacks block-level children vertically by default — uikit has no such default.

**Fix:** Every container-role element needs an explicit `class` with `display: flex` and
`flex-direction` set, even ones that exist purely for id-based runtime toggling.

---

## Base button centering must be `display:flex + align-items:center + justify-content:center`, not `text-align:center`

**Symptom:** Button labels/icons are horizontally centered but not vertically — looks
subtly "off," especially in fixed-size square buttons where a single glyph needs to be centered
on both axes.

**Root cause:** `text-align: center` only centers inline content within its own box on the
horizontal axis. It doesn't replicate a real `display:flex; align-items:center;
justify-content:center` button (the actual convention this project's `panel.css` `.button` base
class uses).

**Fix:** Always use the flex-centering trio for anything meant to look like this app's standard
button, not `text-align`.

---

## Console errors need special-casing for `Error` objects, or the real reason gets swallowed

**Symptom:** A custom in-headset debug console (see `LessonsLearned.md`'s "Debugging JS console"
entry) showed `[PanelUISystem] Error loading panel for entity 9: {}` — the actual error message
was gone, just empty braces.

**Root cause:** `console.error('...', someError)` passes the `Error` object as a second arg.
`JSON.stringify(error)` on a plain `Error` produces `"{}"` — `message`/`stack` aren't enumerable
own properties, so they're dropped.

**Fix:** Any custom console-mirroring/logging code needs an explicit case for `instanceof Error`
(e.g. `` `${err.name}: ${err.message}` ``) before falling back to `JSON.stringify`.

---

## `.uikitml` → JSON is fetched once per page load, with no cache-busting

**Symptom:** Edited `.uikitml`, the dev server's file watcher recompiled it (visible in the
terminal), but the running app still shows the old content even after what looks like a reload.

**Root cause:** `PanelUISystem.loadPanel()` does a plain `fetch(config)` against
`/ui/<name>.json` with no cache-busting query param, and only loads it **once** per entity, ever
— editing the source file after that entity's already loaded has zero effect on the running
session. Compounding this, the browser's own HTTP cache can also serve a stale response even on
a normal reload.

**Fix:** After editing a `.uikitml` file, do a **hard reload** (Ctrl+Shift+R), not a normal one.
If still stale, the app itself likely needs a full restart (not just a page reload) if the
in-memory entity already has a loaded `PanelDocument`.

---

## Hiding a `PanelUI` panel needs two separate gates, not just `visible = false`

`Object3D.visible = false` hides rendering only — clicks still land and the ray cursor still snaps
to it. Two independent systems don't consult `visible`: uikit's own click dispatch (governed by
`pointerEvents`) and IWSDK's ray-cursor targeting (driven by the `RayInteractable` component).

**Fix:** also do `entity.removeComponent(RayInteractable)` + `doc.rootElement.setProperties({
pointerEvents: 'none' })` (and the reverse to re-enable) alongside toggling `visible`.

---

## `<img src="....svg">` is the safe way to embed a real (non-rasterized) SVG icon

**Symptom:** Need to reproduce an existing SVG icon (e.g. a back-arrow chevron) inside a
`.uikitml` panel.

**Finding:** `@pmndrs/uikitml`'s parser auto-detects `<img src="...">` where the `src` ends in
`.svg` and compiles it as a real vector `Svg` component (`type: "svg"`), not a rasterized image.
This is much lower-risk than authoring raw `<svg>...</svg>` or `<inline-svg>` markup directly in
`.uikitml` text — the interpreter does support those tags too (`svg`/`inline-svg` cases exist),
but embedding a real SVG's nested `<path>` tags inside `.uikitml`'s own HTML-like text parser
risks the parser trying to interpret them as its own elements. `<img src="/icon.svg">` sidesteps
that entirely — the SVG is fetched and parsed by the `Svg` component's own (separate, standard)
SVG parsing, not uikitml's text parser.

**Fix:** Save the icon as a standalone `.svg` file in `public/`, reference via
`<img src="/name.svg" class="...">`. Bake any needed fill color directly into the SVG file's own
`fill="#..."` attribute rather than relying on CSS `currentColor`-style inheritance, which isn't
confirmed to work the same way here.

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

## `classList.remove()` warns (loudly, every render) if the class isn't currently present

Unconditional `classList.remove('state-a', 'state-b')` before adding the active one (a normal DOM
pattern, silent no-op there) makes `@pmndrs/uikit`'s `ClassList.remove()` (`components/classes.js`)
`console.warn` every time, since it's not a no-op here — noisy but cosmetic.

**Fix:** guard with `classList.contains()` before `remove()`/`add()`. See `_setActiveClass()`/
`_setSwatch()` in `XRSettingsScene.ts` for the working pattern.

---

## No separate "missing image" placeholder element needed — just hide the `<img>`

**Finding (from Song/PreScene's album art):** when there's no image to show (e.g. a song with no
album art), don't author a second placeholder `<div>` and toggle between it and the `<img>`. Just
set `display: 'none'` on the `<img>` itself and let its parent container's own background color
show through — that's usually visually identical to a dedicated placeholder anyway, with half the
markup and no extra display-toggle bookkeeping. Set the real `src` and flip `display: 'flex'` back
on once a URL is available. See `XRPreScene.ts`'s `_render()` for the working pattern.

---

## uikit has no native `disabled` attribute — fake it with a class

**Finding (from Song/PreScene's Play button):** there's no equivalent of HTML's `disabled` on
uikit buttons. The working substitute is a `.disabled` class combining `pointer-events: none`
(blocks clicks) with a dimmed `opacity` (signals the state visually), toggled via
`classList.add`/`remove` the same contains()-guarded way as any other state class (see the
`classList.remove()` warning entry above). See `.disabled` in `ui/song.uikitml` and
`_setDisabled()` in `XRPreScene.ts`.

---

## `border-radius` only accepts numeric/pixel values — CSS's `50%` silently doesn't work

**Symptom:** A circular element (`width`/`height` equal, `border-radius: 50%` to make a circle —
the standard CSS trick) doesn't render as a circle.

**Root cause:** uikit's own `.uikitml` compiler warns about this directly (rare — most gotchas in
this doc fail silently): `Property "borderRadius" with value "50%" may not be supported. Border
radius properties only support pixel values (use "10px" or "10")`. Percentages aren't accepted for
any `border-*-radius` property, unlike `width`/`height`/`padding`/etc., which do take percentages.

**Fix:** Use half of the element's own (fixed) `width`/`height` as a literal number instead of
`50%` — e.g. a `width: 4; height: 4;` circular button needs `border-radius: 2;`, not
`border-radius: 50%;`. Only works cleanly when width/height are fixed, known values (which is true
for icon buttons/thumbs/dots — the only things that tend to need a true circle).

---

## Per-frame update hooks can end up silently dead when a screen migrates off html2canvas

A per-frame callback (e.g. live seek position) never fired for a migrated screen, no error anywhere.
Cause: `world.globals.updateActivePanel` was originally called from inside
`HighwaySystem.update()`'s html2canvas throttle block, gated on `panelMesh?.visible` — incidental
coupling, not intentional. Once a screen moves to `PanelUI`, `panelMesh` stays permanently hidden,
so the hook silently never fires.

**Confirmed a sharper version of the same mistake:** an idle-timeout feature gated on
`panelMesh?.visible && inHighwayScene` went dead entirely — those two conditions became mutually
exclusive across screens (never both true for any screen), not just wrong for one.

**How to avoid next time:** when migrating a screen off html2canvas, grep `HighwaySystem.update()`
for every `panelMesh`/`uiPanel`/`xrButtons` read and check whether anything screen-agnostic is
nested inside that gating — pull it out to run unconditionally. Watch especially for a condition
combining "is the old panel visible" with something only ever true on a *different* screen.

---

## `Hovered` — a free, already-computed "is anything pointing at this" signal, worth reusing broadly

**Finding:** `@iwsdk/core`'s `state-tags.d.ts` exports `Hovered`, a transient tag `InputSystem`
automatically adds/removes on any `RayInteractable` entity while a ray *or* hand pinch intersects
it — the same mechanism already driving click routing, not something built for this. Checking
`entity.hasComponent(Hovered)` is a handful of component lookups, not a new raycast, so it's a
performant way to answer "is a hand/controller currently pointing at this thing" for purposes
unrelated to clicking — e.g. this project uses it to know when to un-hide hand-tracking visuals
while a song is playing (`HighwaySystem.update()` in `src/xr/index.ts`). Worth reaching for
whenever a feature needs "is the user interacting with panel X right now" without wanting to pay
for or duplicate raycasting that IWSDK's own input pipeline already does every frame regardless.

---

## Pointer-drag math: neither `.uv` nor `.localPoint` on the event can be trusted blindly — always `stableElement.worldToLocal(event.point)`

`event.uv` didn't track drag position reliably (unconfirmed why). `event.localPoint` is relative to
`intersection.object` — whichever sub-element was actually hit first — so its reference frame
silently shifts depending on exactly what the drag grabbed (fill bar vs. thumb vs. tick mark).
uikit's own scrollbar code (`scroll.js`'s `setupScrollHandlers`) avoids this the same way we should:
capture the stable container once and always use `container.worldToLocal(event.point.clone())`.

```ts
const track = doc.getElementById('as-seek-track');
const pointerFraction = (e) => {
    if (!e.point) return null;
    const local = track.worldToLocal(e.point.clone());
    return Math.max(0, Math.min(local.x + 0.5, 1)); // local space is centered: x=0 center, ±0.5 edges
};
```

**Coordinate convention:** local space is normalized and centered — `0` is the element's own
center, `±0.5` its edges (confirmed via `scroll.js`'s `getIntersectedScrollbarIndex`/
`computeScrollbarTransformation`), so `localX + 0.5` is the 0-1 fraction across an element's width.

---

## `setPointerCapture`/`releasePointerCapture` work for XR ray/hand drag — confirmed pattern for "grab and drag past the element's bounds"

`@pmndrs/pointer-events` implements real pointer capture (browser-standard semantics). Calling
`event.currentTarget.setPointerCapture(event.pointerId)` on pointer-down keeps `onPointerMove`/
`onPointerUp` firing even once the ray/hand leaves the element's bounds — without it, drag only
works while directly hovering, which feels broken for anything wider than a few cm. Confirmed with
both ray and hand-pinch. No built-in slider/scrubber component exists in `@iwsdk/*`/`@pmndrs/*` —
this capture + `worldToLocal` combo is the primitive to build one from.

**Reusable pattern** (`_wireSeekDrag()`/`_applyProgress()` in `XRActiveScene.ts`): capture a *grab
offset* on pointer-down so the element tracks relative to where you grabbed, not the raw cursor;
commit on pointer-up. Two refinements worth building in from the start for any scrubber: (1) a
quick pointer-down→up under ~200ms should jump straight to the tapped position (the plain
offset logic otherwise computes a no-op offset from the pre-existing value); (2) call the real
seek/update on every `onPointerMove`, not just a visual preview, so the user sees where release
will land instead of guessing from the bar alone.

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

## No system/OS text-entry keyboard is reachable from this app — Library's search box needs a custom on-screen keyboard (FOLLOW-UP, not yet built)

Library's search field works around the lack of a text-input primitive with an invisible
`<input>.focus()` to trigger Quest's IME — this reportedly crashes the immersive session. No
keyboard component exists in `@pmndrs/*`/`@iwsdk/*`. The spec-sanctioned fix (WebXR `dom-overlay`)
isn't reachable either: `@iwsdk/core`'s `XROptions.features` is a closed set of 9 named flags
(`xr.d.ts`) with no `dom-overlay`/`domOverlay` support anywhere, and wiring it in would mean
patching `node_modules` or hand-rolling session bootstrap outside the sanctioned API — not attempted.

**How to apply:** treat this as a hard platform constraint. Follow-up task, deferred until Library's
uikit migration: build a custom on-screen keyboard from uikit buttons (`onClick` appending/deleting
from the search string), same as every other production VR app does for the same reason.

---

## No CSS Grid — `@pmndrs/uikit`'s flex schema is Yoga-based, flexbox only

**Symptom:** Considering how to port a 3-column `grid-template-columns: repeat(3, 1fr)` song list
(Library) into `.uikitml`.

**Root cause:** Confirmed by reading `@pmndrs/uikit`'s flex property schema directly — there is no
`display: grid` and no grid-template-* property of any kind. Flexbox (via Yoga) is the only layout
model available.

**Fix:** `display: flex; flex-direction: row; flex-wrap: wrap;`, with each item given a **literal
cm width** (not a percentage) sized for however many columns are wanted within the container's
known interior width.

---

## `overflow: scroll` + `flex-wrap: wrap` on the same element works

Confirmed in-headset for Library's song grid: one element is both the wrapping grid *and* the
scrollable viewport (same single-element shape as Settings' `.body`), rather than a separate
viewport/inner split. No separate scroll-track markup needed, matching every other
`overflow: scroll` container in this app.

---

## `UIKit.Image` and `UIKit.Text` exist alongside `UIKit.Container`, same constructor shape

**Finding:** `new X(inputProperties?, initialClasses?, inputConfig?)` — identical shape across all
three, confirmed via `@pmndrs/uikit`'s own component source and now via Library's runtime-built
song rows: `new UIKit.Image({ src: url }, ['some-class'])` /
`new UIKit.Text({ text: 'a string' }, ['some-class'])` compose exactly like `.uikitml` markup does.

**How to apply:** Any future runtime-built row/list can use `Container` + `Image` + `Text`
together, not just bare `Container`s (previously only exercised by Play HUD's plain, childless
section-tick marks).

---

## An SVG's `fill="currentColor"` breaks uikit's image loader

**Symptom:** Console error, "currentColor doesn't exist" (not a silent failure this time).

**Root cause:** `currentColor` requires real CSS-cascade context to resolve against — uikit's
standalone SVG parsing has none. Every other icon already in this project uses a literal
`fill="#ffffff"` instead (confirmed by checking `back-arrow.svg`/`settings-gear-icon.svg`).

**Fix:** Any new icon SVG must use a literal hex fill, never `currentColor`. Same category as the
missing-glyph character list below — check for this on sight before wiring in a new icon, don't
wait for the bug report.

---

## A `class="foo"` with no matching `.foo { }` rule compiles and runs silently

**Symptom:** None visible — the element just renders unstyled/inheriting from its parent. No error,
no warning.

**Root cause:** The compiler doesn't cross-check that every class referenced in markup has a
corresponding rule in the `<style>` block.

**Fix:** Write a small Node script that loads the compiled `public/ui/*.json`, walks every
`element.properties.class`, and diffs against `Object.keys(json.classes)`. One real instance found
this way (a `sort-label` span had the class in markup but no rule — harmless here since it
inherited color/font-size from its parent button, but easy to miss otherwise).

**How to avoid next time:** Run this diff — alongside the shorthand-property grep above — on the
compiled JSON before every in-headset handoff, not just eyeballing the source file.

---

## Correction: single-value shorthand (`padding: 1;`) is NOT safe either

This doc previously claimed single-value padding/margin/gap shorthand was fine (only multi-value
"1 1 0 1" shorthand was called out as broken) — that claim was never actually re-verified against
compiled output. It's wrong: `padding: 1;` compiles straight through as a literal bare `"padding":
"1"` key, the exact same silent-failure shape as multi-value shorthand. **Treat all
padding/margin/gap shorthand, single-value or not, as unsupported, full stop.** Same grep
(`"padding":`/`"margin":`/`"gap":` bare keys in the compiled JSON) catches this too.

---

## `pointerEvents: 'auto'` set before the panel's `PanelDocument` exists silently no-ops forever

A `PanelUI` panel rendered and registered ray hits, but nothing on it ever reacted to clicks —
permanently. Cause: the two-gate show function read `panelEntity.getValue(PanelDocument,
'document')` synchronously and called `doc?.rootElement.setProperties({ pointerEvents: 'auto' })`
— a silent no-op if `doc` is still `null` because the panel's async `fetch()` hasn't resolved, and
nothing ever retries. First hit on Library, the first screen shown at boot.

**Fix:** set `pointerEvents: 'auto'` from *inside* the doc-ready poll callback, where `doc` being
real is guaranteed by construction, not from an external caller hoping it's ready. Other screens
have the same theoretical race but never hit it since they show well after boot — apply this fix
proactively to any future panel shown early, don't wait for a bug report.

---

## A differently-sized panel needs its Y offset solved from the bottom-edge gap, not copied from same-slot siblings

**Symptom:** A panel visually overlaps/clips into the grab bar it's attached to.

**Root cause:** Settings/Song/Play/Calibration are all a fixed 0.4m × 0.3m, centered at local
Y = 0.169 on their shared parent (`grabBarEntity`) — chosen so a 0.3m-tall panel's *bottom edge*
sits 0.019m above the bar (`0.169 - 0.3/2`). Library is taller (0.525m, for its 3-column grid) and
initially reused the same 0.169 center offset, which pushed its bottom edge to
`0.169 - 0.525/2 ≈ -0.094` — below the bar, physically overlapping it.

**Fix:** When a panel's height differs from its same-slot siblings, solve for the center offset
that preserves the same *bottom-edge* gap, not the same center Y: center offset = (desired
bottom-edge gap) + (this panel's own height / 2), re-derived per panel, not copied.

---

## Before deleting any `world.globals.*` slot or shared helper, grep the entire directory for every reader/writer

**Symptom:** A planned cleanup (deleting the legacy `panelMesh`/`uiPanel`/`panelTex`/`resizePanel`/
`xrButtons` html2canvas pipeline once the last known consumer migrated to uikit) turned out to be
unsafe.

**Root cause:** `CalibrationSystem.ts` — a completely different screen, not the one being
migrated in that pass — independently read/wrote the same globals for its own UI. "No longer used
by the screen I'm touching" is not the same claim as "no longer used by anything," and it's easy to
only check the file(s) actually being edited.

**Fix:** Grep `src/xr/` (or wherever the globals live) for every reader/writer of a global before
deleting it, not just the files in the current change. (Once `CalibrationSystem.ts` also migrated
to uikit in a later pass, this pipeline genuinely became dead and the cleanup was completed then.)

---

## A "show a loading state" update can be dead code if it targets a panel that's already hidden by the time it fires

**Symptom:** Planned to replace `uiPanel.innerHTML = 'Loading'` with an equivalent overlay on a new
uikit panel.

**Root cause:** Traced the actual call sites first and found the functions that would trigger it
only ever fire as callbacks from a *different* screen that has already hidden the panel in
question by that point. The replacement would have been exactly as invisible as the original (which
updated a mesh's texture already hidden behind the other screen) — the original had the same latent
dead-code problem, it just degrades silently instead of erroring.

**Fix:** Dropped the loading-overlay markup and wiring entirely rather than ship a cleaner-looking
copy of the same non-functional code.

**How to avoid next time:** Before porting a "show a loading state" update, trace every call site of
the function that triggers it — the panel it updates may not be the one visible when it runs.

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

## A panel shown from multiple independent entry points needs its "hide every sibling" logic centralized in the callee, not assumed handled by the caller

Two panels z-fought after hardcoding a sibling-hide at just one `index.ts` call site for
`CalibrationSystem`'s panel — wrong layer, since that panel is triggered from three independent
places (PreScene/Play HUD Reposition, first-time calibration) and no single caller could be trusted
to know to hide siblings for the others.

**Fix:** move "hide every other panel, show mine" into the callee that actually knows it's about to
show a panel (`CalibrationSystem._showPanel()`), not into any one external caller.

---

## A completion callback can be a lightweight rerender instead of a full screen rebuild — restoration must match the completion shape, not be assumed generic

A panel hidden to show a temporary one stayed permanently invisible after the flow finished. Cause:
two structurally-identical-looking call sites (`CalibrationSystem`'s `recalibrate` vs.
`showCalibrationFineTune`) actually differ in what `onComplete()` does — one's a full screen
rebuild that re-establishes visibility from scratch, the other's a lightweight in-place rerender
that never touches panel `.visible` at all.

**Fix:** wrap the specific completion callback to explicitly restore hidden-panel visibility before
forwarding to the real `onComplete` — don't assume the caller's completion path will fix it. Two
call sites that look the same aren't necessarily interchangeable.

---

## When there's no real confirmation step to offer, skip the panel entirely rather than showing one for consistency

Guitar/Bass calibration has no physical instrument to touch-calibrate against — placement is always
the same deterministic camera-forward drop, for both first-time calibration and every later
reposition. It previously showed a "Grab the bar to reposition" confirm-and-Done screen out of
habit, matching Keys' shape, even though there was never anything to actually confirm. Removing the
confirm screen entirely (place the bar, save, call `onComplete()`, done — no panel, no doc lookup,
no button wiring) simultaneously fixed a visible-panel-flashing bug reported for Guitar's
Reposition (nothing to hide when no panel ever shows) and deleted an entire now-provably-dead
method and uikitml section. Worth checking for this shape generally: a "confirmation" screen that
never actually has anything for the user to decide is a candidate for deletion, not preservation.

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

## `pointerEvents` inherits down the tree, and a descendant's own explicit value always wins

`pointerEvents` is inherited (`properties/inheritance.js`), defaulting to `parent.pointerEvents ??
this.defaultPointerEvents`. Useful for disabling every *other* interactive element during a real
drag: flip the panel root to `'none'`, give the dragged element its own explicit
`pointer-events: auto;` in `.uikitml` to override it. Only toggle once a drag is *confirmed* (past
the movement threshold) — it's re-checked live on every raycast, so flipping it before a tap's
matching `pointerup` could change what object the release resolves to.

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

---

## A "resolve and cache a resource" helper shouldn't also have a side effect that only some callers want

**Symptom:** A panel's `pointerEvents` silently flipped back to `'auto'` while it was still invisible
and had never legitimately been shown — coincident with whatever screen was actually displaying,
causing hover flicker between the two.

**Root cause:** `CalibrationSystem._withDoc()` — a generic "poll until the doc resolves, cache it,
run the callback" utility — set `pointerEvents: 'auto'` the first time it ever resolved a real doc.
It's called by read-only paths too (`refreshValues()` via `reapply()` via `tryLoadCalibration()`,
which fires just from browsing to a song, not from showing the panel), so the side effect fired for
callers that never meant to enable anything.

**Fix:** Keep resource-caching helpers free of side effects entirely — interactivity should only
ever be toggled by the explicit setter built for that purpose, never as a byproduct of an unrelated
read.

---

## A callee that hides siblings via `.visible` alone is only safe because every caller happens to also disable interactivity itself

**Symptom:** Play HUD stayed fully clickable, invisible, underneath the calibration panel — a full
coincident overlap, not just a near-miss.

**Root cause:** `CalibrationSystem._showPanel()` toggled only `.visible` on sibling panels — it had
no access to their real interactivity setters (`RayInteractable` + `pointerEvents`), because only
its own setter was ever exposed on `world.globals`. Worked everywhere except one caller (Play HUD's
Reposition button) that only ever disabled `.visible` itself, assuming `_showPanel()` would handle
the rest.

**Fix:** Expose every sibling's real interactivity setter the same way, and have the callee call
them directly rather than trusting that whichever caller invoked it already did so — a callee that
can enforce its own invariant shouldn't depend on every caller remembering to.

---

## A dropdown needing both a fixed and a variable-length option list splits into two methods sharing one private tail

**Finding:** `OptionDropdown` (the extracted shared XR dropdown class — see the phase-1 entries
above) needs two shapes: `render()` for options already declared in markup with known ids (Speed's
fixed 10), and `renderDynamic()` for a count/labels that vary per instance (Difficulty's per-song
list) — creating/destroying `UIKit.Container`+`Text` nodes each call, same pattern as
`_buildSectionTicks`/Library's rows. Both funnel into one shared private tail (trigger/chevron
toggle, centering math, scroll wiring) that doesn't care how the option elements were obtained —
only the "how do we get the elements" step differs.
