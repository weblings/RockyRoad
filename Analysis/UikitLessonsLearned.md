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
