# uikit/uikitml — syntax and styling

Gotchas in `.uikitml` markup/CSS-like properties themselves. See [`INDEX.md`](INDEX.md) for the
full ui-toolkit map.

---

## `.uikitml` has no CSS shorthand — and using it fails silently, far from the error

`@pmndrs/uikit`'s schema has no combined `padding`/`margin`/`gap`, only the directional forms
(`padding-top`, `gap-row`, etc). The compiler doesn't validate this — `padding: 1 1 0 1;` compiles
straight through and only fails later at runtime, deep inside `interpret()`, far from the source
line. This includes **single-value shorthand** (`padding: 1;`) — not just multi-value — it compiles
straight through as a literal bare `"padding": "1"` key, the same silent-failure shape.

**Fix:** always write out directional properties individually, never shorthand, single-value
included. Before shipping, grep compiled `public/ui/*.json` for bare `"padding":`/`"margin":`/
`"gap":` keys.

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

## `classList.remove()` warns (loudly, every render) if the class isn't currently present

Unconditional `classList.remove('state-a', 'state-b')` before adding the active one (a normal DOM
pattern, silent no-op there) makes `@pmndrs/uikit`'s `ClassList.remove()` (`components/classes.js`)
`console.warn` every time, since it's not a no-op here — noisy but cosmetic.

**Fix:** guard with `classList.contains()` before `remove()`/`add()`. See `_setActiveClass()`/
`_setSwatch()` in `XRSettingsScene.ts` for the working pattern.

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

## `UIKit.Image` and `UIKit.Text` exist alongside `UIKit.Container`, same constructor shape

**Finding:** `new X(inputProperties?, initialClasses?, inputConfig?)` — identical shape across all
three, confirmed via `@pmndrs/uikit`'s own component source and now via Library's runtime-built
song rows: `new UIKit.Image({ src: url }, ['some-class'])` /
`new UIKit.Text({ text: 'a string' }, ['some-class'])` compose exactly like `.uikitml` markup does.

**How to apply:** Any future runtime-built row/list can use `Container` + `Image` + `Text`
together, not just bare `Container`s (previously only exercised by Play HUD's plain, childless
section-tick marks).

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
