# uikit / uikitml Lessons Learned

Gotchas specific to the `PanelUI`/`@pmndrs/uikit`/`.uikitml` migration (see `WebXR_IWSDK.md`
Phase 7 and `ImplementationPlan.md` for the migration itself). Split out from the main
`LessonsLearned.md` since this is a large, self-contained topic — see that file's pointer entry.

---

## `.uikitml` has no CSS shorthand — and using it fails silently, far from the error

**Symptom:** `PanelUI` panel renders as completely blank. Console shows
`[PanelUISystem] Error loading panel for entity N: <something>` — but by default the `<something>`
is unhelpful (see the console-formatting gotcha below).

**Root cause:** `@pmndrs/uikit`'s property schema is a **strict** Zod object — there is no
combined `padding`, `margin`, or `gap` property, only the fully-expanded directional ones:
`padding-top`/`padding-right`/`padding-bottom`/`padding-left`, `gap-row`/`gap-column`. The
`.uikitml` **compiler** doesn't validate this — it happily compiles `padding: 1 1 0 1;` into
`"padding": "1 1 0 1"` in the JSON with no error. The failure only happens later, at **runtime**,
when `@pmndrs/uikitml`'s `interpret()` tries to apply that property and the schema rejects it —
by which point the error is several layers removed from the actual bad line in the source file.

**Fix:** Never use shorthand. Always write out all four `padding-*` / two `gap-*` properties
individually, even for values that would be a single-value shorthand in real CSS. A single-value
form like `padding: 2;` (all sides equal) *is* fine — the interpreter accepts it as-is for each
individual directional property; the "1 1 0 1" 2/4-value shorthand syntax is what's unsupported.

**How to avoid next time:** Before shipping a new `.uikitml` file, grep the compiled
`public/ui/*.json` output for `"padding":`/`"margin":`/`"gap":` (bare, no `Top`/`Row`/etc. suffix)
— if any of those keys exist, something used shorthand and will fail at runtime.

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

**Symptom:** Set `panelObj.visible = false` on a `PanelUI` entity that should be hidden/inert.
Its content is invisible, but: (a) clicking where it used to be still triggers its buttons, and/or
(b) the ray cursor still visually stops/snaps at its (invisible) surface instead of passing
through to whatever's actually behind it.

**Root cause:** There are **two independent systems** that don't consult `Object3D.visible` the
way you'd expect:
1. **`@pmndrs/uikit`'s own click/hover dispatch** — governed by the `pointerEvents` property
   (`'auto' | 'none' | 'listener'`, same semantics as CSS `pointer-events`), not by whether the
   Object3D subtree is visible.
2. **IWSDK's `InputSystem` ray-cursor targeting** — driven by which entities currently have the
   `RayInteractable` **component**, collected into `rayDescendants` once when the component set
   changes (on `addComponent`/`removeComponent`, not on visibility changes). An entity keeps its
   `RayInteractable` tag — and stays a ray-cursor target — regardless of `visible`.

**Fix:** To fully disable an inert-but-still-mounted `PanelUI` entity:
```ts
entity.removeComponent(RayInteractable);        // drop out of IWSDK's ray-cursor targets
doc.rootElement.setProperties({ pointerEvents: 'none' }); // block uikit's own click dispatch
```
and the reverse (`addComponent(RayInteractable)` + `pointerEvents: 'auto'`) to re-enable. Do
this *in addition to* toggling `visible` for the actual rendering — `visible` alone is necessary
but not sufficient for either gate. (An earlier, cruder workaround — physically moving the panel
1000 units away — also worked, since it removes the spatial overlap entirely, but the two-gate
approach above is the correct fix and doesn't require fighting with a position hack.)

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

**Symptom:** A completely unrelated, unchanged element (a header/back-button, in a different
subtree from the content that changed) started rendering at the wrong size — stretched to ~full
panel width, wrong height — but *only* when a specific, larger/more-text-heavy section of the
document was the one currently visible (toggled via `display`). Confirmed via `element.size.value`
(see below) that the back-button's own CSS/markup never changed; the same static element measured
`[5.5, 2.5]` normally and `[39, 1.6]` when the bug triggered. A related, milder symptom hit at the
same time: `overflow: scroll`'s scroll range (`element.maxScrollPosition.value`) was also
measuring wrong — scroll worked briefly then stopped, and the scrollbar itself wasn't draggable.

**Root cause (best working theory, not confirmed against library source beyond behavior):**
`inter` glyphs are lazy-loaded per-character, asynchronously, the first time any given character
is rendered anywhere in the document (`@pmndrs/msdfonts`). Adding a chunk of static filler content
with several brand-new, never-before-rendered strings (unique digits/words not used elsewhere in
the doc) to test scrolling caused a burst of many concurrent async glyph-load-triggered remeasure
passes. Yoga's native layout engine doesn't appear to be safe against overlapping/reentrant
`calculateLayout()` calls — a large enough burst of simultaneous remeasures from one subtree can
scribble a wrong computed size into a completely unrelated node elsewhere in the same document.
Both symptoms (header stretch, scroll-range corruption) disappeared immediately and completely
once the filler content (the burst source) was removed — no CSS change was needed or made.

**How to diagnose this class of bug:** there's no thrown exception or console error — Yoga just
silently produces wrong numbers. Add temporary instrumentation instead: give the suspect elements
an `id`, then read `element.size.value` (and `element.scrollable.value` /
`element.maxScrollPosition.value` for scroll containers) directly — these are public signals on
every `Component` (`node_modules/@pmndrs/uikit/dist/components/component.js`). Log them a few
hundred ms after the render/state change that supposedly triggers the bug (layout settles
asynchronously, so logging synchronously in the same tick shows stale/undefined values), and
compare the numbers between a "working" and "broken" state to confirm it's a real miscomputation
rather than a CSS issue.

**How to avoid next time:** be wary of adding a large amount of brand-new, never-before-rendered
text to a document all at once (a big static content dump, or — more relevant going forward — the
Library screen's unbounded, server-driven song list, where every new song title is new text the
first time it scrolls into view). If a future screen hits unexplained layout corruption in an
unrelated element that correlates with "how much new text just appeared," this is the first thing
to suspect — consider whether the new content can be introduced incrementally (e.g. paginated/
virtualized row creation) rather than all at once, to spread out the glyph-load burst.

**Repro is flaky across reloads — don't trust a single "seems fixed" report.** Because the trigger
is specifically *never-before-rendered* glyphs, whether a given reload reproduces the bug depends
on whatever's already sitting in the glyph/font-atlas cache from earlier in the browser session —
a fresh cold start reliably repros it, but a reload soon after (with the same characters already
cached from the previous load) can look fine even with the buggy content still present. This
session burned several round-trips on unrelated CSS edits (padding values, a classList warning
fix) that appeared to "fix" or "reintroduce" the bug purely by coincidental timing with cache
state, before the real cause (the filler text itself) was isolated. If a fix for this class of bug
needs confirming, retest with a genuinely cold browser start, and ideally more than once.

---

## `overflow: scroll` alone isn't enough — children need `flex-shrink: 0`, and the scrollbar needs explicit width/color

**Symptom 1:** Setting `overflow: scroll` on a fixed-height container with more content than fits
doesn't produce a scrollable overflow — instead all the content visibly compresses/squishes to fit
within the container's bounds, as if `overflow` had no effect at all.

**Root cause:** Real CSS engines special-case this: a flex item's automatic minimum size resets to
0 once its own `overflow` isn't `visible`, which is what lets *it* overflow its parent instead of
being forced to shrink. This Yoga port doesn't extend that special-casing down to the *children*
of the scroll container — `node_modules/@pmndrs/uikit/dist/flex/node.js`'s `updateMeasurements()`
only uses `overflow` to compute the scrollbar's range (`maxScrollPosition`) after the fact; it
doesn't stop Yoga's normal flex-shrink pass (default `flex-shrink: 1`, same initial value as real
CSS) from compressing children to fit *first*.

**Fix:** Give the scroll container's direct child(ren) `flex-shrink: 0` explicitly. That's what
lets them keep their natural size and overflow the container, which is what `.body`'s
`overflow: scroll` then has something to actually scroll through.

**Symptom 2:** The first time a container's content actually overflows and a scrollbar appears, it
renders as a large, pale/white bar taking up a big chunk of the panel — much wider than a normal
scrollbar should be.

**Root cause:** `@pmndrs/uikit`'s default `scrollbarWidth` is `10`
(`node_modules/@pmndrs/uikit/dist/properties/defaults.js`) — in the *same raw unit scale* as
everything else you author in `.uikitml` (i.e. `10` = 10cm if you're using a 1-unit-=-1cm scale),
not a sensible small pixel default. There's also no default `scrollbarColor` at all.

**Fix:** Always set both explicitly on any element with `overflow: scroll`:
```css
scrollbar-width: 0.3;       /* tune to taste — default 10 is roughly 30x too wide at 1cm scale */
scrollbar-color: #4a4a4a;
```

---

## `classList.remove()` warns (loudly, every render) if the class isn't currently present

**Symptom:** Console spam on every re-render: `Class 'toggle-active' not found in the classList` /
`Class 'toggle-inactive' not found in the classList`, for classes that obviously *do* exist and
are used correctly elsewhere. Purely cosmetic — doesn't break anything — but it's noisy enough to
obscure real errors when debugging something else at the same time.

**Root cause:** A common toggle-button re-render pattern is to unconditionally call
`classList.remove('state-a', 'state-b')` before adding whichever one currently applies — cheap and
simple in real DOM (`classList.remove` on an absent class is a silent no-op there). In
`@pmndrs/uikit`, `ClassList.remove()` (`node_modules/@pmndrs/uikit/dist/components/classes.js`)
explicitly `console.warn`s if the class isn't in the element's current list, since each element
only ever has *one* of the two states at a time — the absent one triggers a warning every time.

**Fix:** Guard with `classList.contains()` before calling `remove()`/`add()`:
```ts
if (el.classList.contains(removeClass)) el.classList.remove(removeClass);
if (!el.classList.contains(addClass))   el.classList.add(addClass);
```
See `_setActiveClass()`/`_setSwatch()` in `src/xr/XRSettingsScene.ts` for the working pattern —
reuse it for any future toggle/selected-state UI (Library's filter chips, Song's difficulty
selector, etc.) rather than porting the naive unconditional-remove pattern from HTML/CSS code.

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

**Symptom:** A callback registered to run every frame (e.g. live seek-bar position, elapsed time)
never fires at all for a uikit-migrated screen — not "wrong values," genuinely never called, with
no error anywhere.

**Root cause:** in this project specifically, the per-frame update hook
(`world.globals.updateActivePanel`, set via `registerPanelUpdate()`) was originally called from
inside `HighwaySystem.update()`'s html2canvas capture-throttle block, itself gated on
`panelMesh?.visible`. That gating made sense back when the call only ever served the html2canvas
Play HUD — but it was **incidental coupling**, not an intentional design decision that the update
hook should depend on html2canvas. Once the screen migrates to a `PanelUI` entity, `panelMesh` is
permanently hidden while that screen shows, so the hook silently never fires.

**How to avoid next time:** when migrating any screen off html2canvas, grep for every place that
reads `panelMesh`/`uiPanel`/`xrButtons` in the shared per-frame update code (`HighwaySystem.update()`
in `src/xr/index.ts`) and check whether anything *else* important — not just the html2canvas
render itself — is nested inside that gating. Anything genuinely screen-agnostic (this update hook,
potentially others added later) needs to be pulled out to run unconditionally, not just the obvious
html2canvas capture call.

**Confirmed a second time, with a sharper version of the same mistake:** an idle-timeout feature
(dim the panel + hide hand-tracking visuals after 3s of no panel interaction, gated on
`panelMesh?.visible && inHighwayScene`) went completely dead once Song/Play also migrated off
html2canvas — but not just "sometimes wrong": `panelMesh?.visible` (only true during Library) and
`inHighwayScene` (always false during Library, since `disposeHighway()` runs before `showLibrary()`)
became **mutually exclusive**, so the condition could never be true again, for any screen, at all.
The specific thing worth checking for next time: after a migration, look for any condition
combining "is the old html2canvas panel visible" with something else that's *only ever true on a
different screen* — that combination isn't just fragile, it can silently become impossible outright.

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

**Symptom (two-stage bug, same underlying cause):** a seek-bar drag interaction (1) didn't track
the interactor's position at all when read via `event.uv.x`, then (2) after switching to
`event.localPoint.x`, moved but not smoothly/consistently with the interactor's actual movement.

**Root cause, stage 1 (`.uv`):** unclear/unconfirmed — possibly related to how uikit's instanced
panel rendering interacts with `@pmndrs/pointer-events`' generic ray-plane UV recomputation during
pointer capture continuation (`intersectPointerCapture` in
`node_modules/@pmndrs/pointer-events/dist/intersections/ray.js` re-derives `.uv` via a
`getClosestUV()` call against the intersected mesh's raw geometry, which may not account for
per-instance transforms correctly). Not fully root-caused — moving off `.uv` entirely turned out
to be the right call regardless.

**Root cause, stage 2 (`.localPoint`):** confirmed. `event.localPoint` is computed relative to
`intersection.object` — whichever sub-element the ray/hand *actually hit first*. A seek track has
several children at different positions within it (the fill bar, the thumb, section-tick marks),
so depending on exactly what the interactor lands on, `.localPoint`'s reference frame silently
shifts between them. `@pmndrs/uikit`'s own scrollbar-drag code
(`node_modules/@pmndrs/uikit/dist/scroll.js`'s `setupScrollHandlers`) never uses the event's own
`.localPoint` for this exact reason — it explicitly calls `container.worldToLocal(event.point.clone())`
against the *known, stable* container element every time.

**Fix:** capture a reference to the stable element once (e.g. the track itself, not whatever the
event says it hit) and always call `.worldToLocal(event.point.clone())` on *that* reference:
```ts
const track = doc.getElementById('as-seek-track');
const pointerFraction = (e) => {
    if (!e.point) return null;
    const local = track.worldToLocal(e.point.clone());
    return Math.max(0, Math.min(local.x + 0.5, 1)); // see below for the +0.5
};
```
`event.point` (world-space) is unambiguous regardless of what was actually hit — it's only the
*local* conversion that needs to be pinned to a specific, known element rather than trusted from
the event.

**Also confirmed along the way — uikit's local coordinate space is normalized and centered:** a
local x of `0` is the element's own center, `±0.5` its edges (not raw absolute units, and not a
`0..1` range with a corner origin). Confirmed via `scroll.js`'s `getIntersectedScrollbarIndex`,
which does `point.x *= size[0]` to convert this same local coordinate into absolute units, and
`computeScrollbarTransformation`'s use of `size[i] * 0.5` as the edge boundary. So `localX + 0.5`
is the 0-1 fraction across an element's width — no division by size needed for that specific case.

---

## `setPointerCapture`/`releasePointerCapture` work for XR ray/hand drag — confirmed pattern for "grab and drag past the element's bounds"

**Finding:** `@pmndrs/pointer-events` implements real pointer capture, same semantics as the
browser Pointer Events API (`node_modules/@pmndrs/pointer-events/dist/pointer.d.ts`). Calling
`event.currentTarget.setPointerCapture(event.pointerId)` on pointer-down makes `onPointerMove`/
`onPointerUp` keep firing on that same element even once the ray/hand moves outside its actual
bounds — without it, drag input only arrives while directly hovering the element, which feels
broken for anything wider than a few cm (a seek bar, a slider). Confirmed working with both
controller ray and hand-tracking pinch. Release the capture on pointer-up
(`releasePointerCapture`). This is the standard "basic XR drag interaction" building block —
there's no separate slider/scrubber component in this project's dependencies (checked both
`@iwsdk/*` and `@pmndrs/*` in `node_modules`, nothing named Slider/Scrub/Range), so this
capture + `worldToLocal` combination *is* the primitive to build one from.

**Related pattern, worth reusing for any future grab-and-drag UI:** capture a *grab offset* on
pointer-down (the difference between where you actually grabbed and the thing's current position),
apply that offset throughout the drag so the element keeps its position *relative to your grab
point* rather than snapping its center to the exact cursor position, and only commit the final
value on pointer-up (previewing the intermediate value visually without touching the underlying
state until release). See `_wireSeekDrag()`/`_applyProgress()`/`_scrubFraction` in
`src/xr/XRActiveScene.ts`.

**Two more UX refinements worth building in from the start for any scrubber, not just bolting on
after the fact:**

1. **Distinguish a quick tap from an actual drag by elapsed time, not just presence/absence of
   movement.** A pointer-down immediately followed by pointer-up (no real hold — under ~200ms is a
   reasonable threshold) reads as "tap to seek here," and should jump straight to the tapped
   position. Left to the plain grab-offset logic above, a quick tap instead computes an offset
   from wherever the playhead *already was* and, since nothing moved, commits that same
   pre-existing position back — a silent no-op that looks like the tap didn't register at all.
   Track a `pointerDownTime`, and on pointer-up branch on `Date.now()/performance.now() -
   pointerDownTime < threshold`: quick tap → use the raw current pointer position as the target;
   real drag → use the accumulated offset-adjusted `_scrubFraction` as before.
2. **Actually move the underlying value during the drag, not just its visual preview.** The
   grab-offset pattern above intentionally defers committing to the real state until pointer-up —
   but for something like a seek bar, only updating the on-screen fill/thumb/time while dragging
   (leaving the actual paused playhead frozen at the pre-drag position until release) means the
   user gets no feedback about *where they're about to land* until they let go. Call the real
   `seekTo()`-equivalent on every `onPointerMove` too, in addition to the visual preview — the
   paused player (and anything else synced to its position, e.g. a 3D highway view) then scrubs
   live with the drag, which is what lets the user actually *see/hear* where release will land
   instead of guessing from the bar's position alone.

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

**Finding:** Library's current search field (`src/xr/XRSongLibrary.ts`) works around the lack of
any real text-input primitive by appending a real, invisible `<input>` to `document.body` and
calling `.focus()` on it to trigger Quest's IME — this reportedly crashes the immersive session.
Investigated whether a proper fix exists:

- Neither `@pmndrs/*` (uikit, pointer-events, uikitml) nor `@iwsdk/*` exports anything
  keyboard-related — grepped both fully, zero matches. No native virtual/system-keyboard component
  exists to reach for.
- The WebXR-spec-sanctioned way to get a real OS text input inside an active session is the
  `dom-overlay` feature. This app already runs `SessionMode.ImmersiveAR` with passthrough
  (`src/xr/index.ts` `World.create()` call — confirmed directly, corrected an earlier wrong
  assumption that it was `immersive-vr`), which is the session mode `dom-overlay` actually needs —
  so session mode isn't the blocker.
- The real blocker: `@iwsdk/core`'s `XROptions.features` (`node_modules/@iwsdk/core/dist/init/
  xr.d.ts`) is a closed, structured set of exactly 9 named feature flags (handTracking, anchors,
  hitTest, planeDetection, meshDetection, lightEstimation, depthSensing, layers, unbounded) — the
  doc comment explicitly says this "avoids raw string arrays." `dom-overlay` isn't one of the 9,
  `buildSessionInit()` only ever pushes tokens from that hardcoded map, and there's no field
  anywhere for the `domOverlay: { root: element }` init object the feature actually requires. A
  full grep of `@iwsdk` for "dom-overlay"/"domOverlay" is empty — it's simply not wired up.
- Getting `dom-overlay` working would require either patching `buildSessionInit` inside
  `node_modules` (wiped on every reinstall/update) or bypassing `launchXR()` entirely and hand-
  rolling `navigator.xr.requestSession()` + `world.renderer.xr.setSession()`, duplicating IWSDK's
  own session-bootstrap logic (reference-space resolution, session-end handling, its "always offer"
  button flow) outside the sanctioned API. Both are more fragile than they sound, and neither was
  attempted — whether `dom-overlay` would even fix the crash (vs. just changing its shape) was
  never confirmed either.

**How to apply:** treat "no system keyboard" as a hard platform constraint, not a bug to keep
chasing. **Follow-up task, deferred until the Library screen's uikit migration**: build a fully
custom on-screen keyboard out of uikit buttons (same `<button class="...">` + `onClick` pattern
already used everywhere else — toggle/stepper/swatch buttons in `settings.uikitml`), wired to
append/delete characters from the search string in TS. This is also what every other production VR
app does for the same reason (Quest's own home search, Horizon Worlds, etc.) — there's no shortcut
around it on this platform.

---

## Library screen (toolbar/dropdown/scrollview/song rows) — CONFIRMED WORKING in-headset

Last screen-by-screen migration off html2canvas. `ui/library.uikitml` + a rewritten
`XRSongLibrary.ts`, same idiom as the other three. Confirmed findings from this pass:

- **No CSS Grid — confirmed absent from `@pmndrs/uikit`'s flex schema** (Yoga-based, flexbox
  only). The original 3-column `grid-template-columns: repeat(3, 1fr)` song list became
  `display: flex; flex-direction: row; flex-wrap: wrap;`, each row given a literal cm width (not a
  percentage) sized for 3 columns within the panel's known interior width.
- **`overflow: scroll` combined with `flex-wrap: wrap` on the same element works** — one element
  is both the wrapping grid *and* the scrollable viewport (same single-element shape as Settings'
  `.body`), rather than a separate viewport/inner split. Confirmed in-headset; no separate
  scroll-track markup needed, matching every other overflow:scroll container in this app.
- **`UIKit.Image` and `UIKit.Text` exist alongside `UIKit.Container`, all three with an identical
  constructor shape** (`new X(inputProperties?, initialClasses?, inputConfig?)`) — confirmed via
  `@pmndrs/uikit`'s own component source, and now confirmed working via Library's runtime-built
  song rows: `new UIKit.Image({ src: url }, ['some-class'])` /
  `new UIKit.Text({ text: 'a string' }, ['some-class'])` compose exactly like `.uikitml` markup
  does. Useful beyond Library: any future runtime-built row/list can use Container + Image + Text
  together, not just bare Containers (previously only exercised by Play HUD's plain, childless
  section-tick marks).
- **An SVG's `fill="currentColor"` breaks uikit's image loader** — surfaced as a console error
  ("currentColor doesn't exist"), not a silent failure this time. Every other icon already in this
  project uses a literal `fill="#ffffff"` (confirmed by checking `back-arrow.svg`/
  `settings-gear-icon.svg`); `currentColor` requires CSS-cascade context uikit's standalone SVG
  parsing doesn't have. **Any new icon SVG must use a literal hex fill, never `currentColor`** —
  worth checking this on sight for any future icon before it even gets wired in, same category of
  "known-bad, check before use" as the missing-glyph character list above.
- **A `class="foo"` attribute with no corresponding `.foo { }` rule in the `<style>` block compiles
  and runs silently** — no error, no warning; the element just renders unstyled/inheriting from its
  parent. Caught by writing a small Node script that loads the compiled `public/ui/*.json`, walks
  every `element.properties.class`, and diffs against `Object.keys(json.classes)`. One real
  instance found this pass (a `sort-label` span had the class in markup but no rule — harmless here
  since it inherited color/font-size from its parent button, but easy to miss otherwise). Worth
  running this diff — alongside the shorthand-property grep below — on the compiled JSON before
  every in-headset handoff, not just eyeballing the source file.
- **Single-value shorthand (`padding: 1;` meaning all four sides) is silently accepted by the
  compiler and does NOT get expanded** — it compiles straight through as a literal bare
  `"padding": "1"` key, the same silent-failure shape as the multi-value shorthand case documented
  above. This directly contradicts this doc's earlier note calling single-value shorthand "fine" —
  that note was never actually re-verified against compiled output before now. **Correction: treat
  *all* padding/margin/gap shorthand, single-value or not, as unsupported**, full stop. Same grep
  (`"padding":`/`"margin":`/`"gap":` bare keys in the compiled JSON) catches this too.
- **A `pointerEvents: 'auto'` toggle set by code that assumes the panel's `PanelDocument` already
  exists can silently no-op forever if that panel is shown before its async load finishes** — the
  bug that actually broke all interaction on first load. `showLibrary()` calls
  `setLibraryPanelInteractive(true)`, which reads `panelEntity.getValue(PanelDocument, 'document')`
  synchronously and does `doc?.rootElement.setProperties({ pointerEvents: 'auto' })` — a silent
  no-op if `doc` is still `null`. Library is the *first* screen shown, at boot, so this call fires
  before `PanelUISystem`'s async `fetch('/ui/library.json')` has any chance to resolve; nothing
  ever retries it afterward, so `pointerEvents` stays stuck at the uikitml's static `'none'`
  default forever — `RayInteractable` still gets added fine (that half is synchronous, no doc
  dependency), so the ray registers a hit, but uikit's own internal click/hover dispatch never
  fires. **Settings/Song/Play have the exact same theoretical race** (their `setXPanelInteractive`
  functions are structurally identical) but never hit it in practice, only because they're shown
  well after boot, by which point their panels have long since finished loading — this is a latent
  bug in all four, just one where only the screen shown immediately at startup actually triggers
  it. **Fix applied to Library only** (scoped to the confirmed-broken screen, not touching the
  other three's already-working code): set `pointerEvents: 'auto'` from *inside* the doc-ready
  callback in `XRSongLibrary.show()`'s poll loop, where `doc` being real is guaranteed by
  construction, rather than relying on an external caller's assumption about timing. **General
  rule: any one-time "make this interactive" toggle that depends on an async resource must be
  triggered from the code that actually observes that resource becoming ready — not fired eagerly
  by a caller that merely hopes it's ready yet.**
- **A differently-sized panel sharing the same grab-bar-relative Y offset as same-sized sibling
  panels will visually overlap the grab bar.** Settings/Song/Play are all a fixed 0.4m × 0.3m,
  centered at local Y = 0.169 on their shared parent (`grabBarEntity`) — chosen so a 0.3m-tall
  panel's *bottom edge* sits 0.019m above the bar (`0.169 - 0.3/2`). Library is taller (0.525m, to
  fit the 3-column grid) and initially reused the same 0.169 center offset, which pushed its bottom
  edge to `0.169 - 0.525/2 ≈ -0.094` — below the bar, physically overlapping it. **When a panel's
  height differs from its siblings but all share the same parent-relative slot, solve for the
  center offset that preserves the same *bottom-edge* gap, not the same center Y** — center offset
  = (desired bottom-edge gap) + (this panel's own height / 2), re-derived per panel, not copied.
- **A planned "delete the now-unused legacy pipeline" cleanup can be blocked by a consumer outside
  the screen being migrated.** Planned to delete `panelMesh`/`uiPanel`/`panelTex`/`resizePanel`/
  `xrButtons` and the html2canvas capture + DOM ray-hit-testing block in `HighwaySystem.update()`,
  assuming Library was the last consumer once migrated. Wrong — `CalibrationSystem.ts` (the
  still-unmigrated fine-tune/reposition screen, reached via `repositionEntry()` →
  `world.globals.showCalibrationFineTune`) independently reads/writes the same
  `uiPanel`/`resizePanel`/`xrButtons` globals for its own UI, entirely unrelated to Library. Caught
  by grepping `XrButton`/`xrButtons`/`uiPanel` across the *whole* `src/xr/` tree, not just the
  files being edited, before deleting anything. **Before deleting any `world.globals.*` slot or
  shared helper, grep the entire directory for every reader/writer** — "no longer used by the
  screen I'm touching" is not the same claim as "no longer used by anything."
- **A loading-state UI update can be dead code if it targets a panel that's already hidden by the
  time it fires.** Planned to replace `playEntry()`/`repositionEntry()`/`calibrateAndPlay()`'s
  `uiPanel.innerHTML = 'Loading'` swap with an equivalent overlay on the new uikit Library panel.
  Traced the actual call sites first and found these three functions only ever fire as PreScene's
  Play/Reposition/Calibrate button callbacks — by which point `showPreScene()` has already hidden
  the Library panel. The replacement would have been exactly as invisible as the original (which
  updates a mesh's texture already hidden behind PreScene at that point) — the original had the
  same latent dead-code problem, it just degrades silently instead of erroring. Dropped the
  loading-overlay markup and wiring entirely rather than ship a cleaner-looking copy of the same
  non-functional code. **Before porting a "show a loading state" update, trace every call site of
  the function that triggers it** — the panel it updates may not be the one visible when it runs.
