---
name: figma-export-cleanup
description: Lessons learned cleaning up Figma HTML/CSS exports for use in this project
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7935a97a-5da6-407a-bf0b-0d9ffb1d32ad
---

When importing Figma-exported HTML/CSS, apply these fixes before doing anything else.

**Why:** Learned hands-on cleaning up Song and Reposition exports for XRProto's XR panels.

**How to apply:** Run through this checklist on every Figma export before treating it as a starting point.

## Plugins used

- **Export (Figma → HTML/CSS):** [HTML & CSS Export by PX2REM](https://www.figma.com/community/plugin/1602025208679642315)
- **Import (HTML/CSS → Figma):** [HTML to Figma](https://www.figma.com/community/plugin/1159123024924461424)

## Exporter choice matters

Two Figma exporters were compared. The scoped-selector exporter (Song2) is far better than the numbered-class exporter (Song):
- Numbered classes (`frame-18-1`, `node-2`, `text-5`) are completely opaque
- Numbered exporter also produces broken CSS (media queries nested inside class selectors without closing)
- Always pick the exporter that produces scoped/nested selectors

## Artifacts to always remove

- **`<title>` used in body** — Figma sometimes exports `<title>Some Text</title>` inside a `<div>` as a text label. This is invalid HTML (`<title>` belongs only in `<head>`). Replace with `<span>` or `<p>`.
- **Invalid HTML attributes** — `<p class="emotion" An Unwavering Heart>` — Figma injects unquoted text directly into opening tags. The browser treats it as a broken attribute name. Strip anything after the class attribute that isn't a valid `key="value"` pair.

- **Canvas padding on root frame** — Figma adds large padding like `221px 100px 43px 0px` from the element's position on the Figma canvas. Remove it entirely; it makes content invisible under `overflow: hidden`.
- **Prototype anchor tags** — `<a class="anchor" id="frame">` has no layout purpose, remove it.
- **CMS template wrappers** — some exporters wrap the whole output in `[[!registerStyle?...]]` or similar CMS tags with inline `<style>` blocks inside. Strip the wrapper entirely and move the CSS to an external file.
- **Trailing CSS artifacts** — exports sometimes end with `</style>\`\`\`]]` or similar; strip it.
- **Float-precision font sizes** — `14.300000190734863px` is a Figma artifact; round to `14px` or keep one decimal at most.
- **Percentage widths from pixel math** — `width: 48.38709677419355%` is a pixel-to-canvas-size conversion; replace with the actual pixel value or a sensible percentage.
- **Invalid class names** — classes like `.0 000` (spaces, leading digit) are invalid CSS. Rename immediately to something like `.value-display`.
- **CSS combinator in class name** — `.background+border` looks like a class name but `+` is the CSS adjacent-sibling combinator, so the rule silently targets the wrong elements with no error. Any `+`, `~`, `>`, or space in a class name must be renamed. This is the most dangerous invalid-class case because it fails silently.

## Class naming issues

- **Content-based text class names** (`tkm`, `boy`, `soy`) — Figma names classes after the literal text content. Rename to semantic names (`song-title`, `artist-name`, `album-name`).
- **`debug`** — Figma's generic label for structural containers. Rename to what the container actually does (`content`, `song-info`, `header`).
- **Unicode character classes** (`.←`) — technically valid CSS but fragile. Rename to `.back-icon` etc.
- **Same class reused at multiple nesting levels** (`margin`, `container`) — check whether all uses should actually share the same CSS. Often they shouldn't (e.g. `margin` was 64×64 for the art wrapper but also applied to text rows, creating big gaps).

## Layout fixes

- **Fixed `height` on intermediate containers** blocks flex children from filling space. Replace with `flex: 1` and let content size naturally.
- **`align-items: flex-start`** is Figma's default on everything. Change to `center` (plus `justify-content: center`) wherever centering is intended.
- **Buttons exported as `<div>`** — add `border: none; cursor: pointer` and convert to `<button>` for semantics.
- **Button text not centered** — Figma button divs use `align-items: flex-start`. Add `align-items: center; justify-content: center`.
- **Same-height sibling sections** — use `align-items: stretch` on the flex row parent so both sections grow to the height of the taller one. Then use `justify-content: space-evenly` inside the shorter section to distribute its content across the extra space.
- **Same color variant, different sizes** — don't create separate classes for small vs large buttons that share the same color. Define the color variant globally (`.button.secondary-dark`) and override size only in the specific context (`.controls .button.secondary-dark { width: 22px; height: 22px; }`).

## Multi-screen projects: extract shared CSS

When cleaning up more than one screen, extract shared structure into a `panel.css`:
- CSS reset, body test setup
- `.frame` shell (fixed size, flex column)
- `.content` region (flex: 1, dark bg, top border-radius)
- `.header` and its back button
- `.actions` bar and action button sizing
- Button color variants (`.button.primary-dark`, `.button.primary-light`, `.button.secondary-dark`) defined at the `.button` level so they work in any context

Each screen's CSS then only contains its own content-area styles.

## Interactive components need JS

Figma exports are static. Any component with persistent selection state needs a small script — CSS `:active` only holds while the mouse is pressed, not after release.

- **Toggle/segmented controls** — on click, reset all siblings to `primary-dark`, promote the clicked one to `primary-light`:
  ```js
  document.querySelectorAll('.toggle-group').forEach(group => {
    group.addEventListener('click', e => {
      const btn = e.target.closest('.button');
      if (!btn) return;
      group.querySelectorAll('.button').forEach(b => b.classList.replace('primary-light', 'primary-dark'));
      btn.classList.replace('primary-dark', 'primary-light');
    });
  });
  ```
- **Swatch pickers** — on click, remove `.selected` from all siblings, add to clicked:
  ```js
  document.querySelectorAll('.swatch-row').forEach(row => {
    row.addEventListener('click', e => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      row.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
  });
  ```
- **Hover preview on unselected swatches** — use `:not(.selected):hover` with a dimmer border color than the selected state (`#666` vs `#dadada`).

## Multi-column scrollable lists

When Figma exports a grid as separate parallel flex columns (each with its own scroll), collapse them into a single CSS grid container:

```css
.song-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-content: start; /* prevents rows from stretching to fill height */
  gap: 4px;
  overflow-y: auto;
}
```

Remove the column wrapper elements entirely — all items become direct children of the grid.

## Custom dropdowns — skip native `<select>` styling

`padding` on `<option>` elements is not reliably supported by any browser (the OS renders the native dropdown, not the browser). Don't attempt to style native selects beyond color and font — go straight to a custom implementation whenever spacing or appearance matters.

Custom dropdown pattern:
```html
<div class="sort-dropdown">
  <button class="sort-trigger" type="button">
    <span class="sort-label">Title A–Z</span>
    <span class="sort-chevron">▾</span>
  </button>
  <div class="sort-menu">
    <button class="sort-option selected" data-value="title-asc" type="button">Title A–Z</button>
    <!-- more options -->
  </div>
</div>
```
```css
.sort-dropdown { position: relative; }
.sort-menu { display: none; position: absolute; top: calc(100% + 4px); right: 0; z-index: 10; }
.sort-dropdown.open .sort-menu { display: flex; flex-direction: column; }
```
```js
const dropdown = document.querySelector('.sort-dropdown');
const label = dropdown.querySelector('.sort-label');
dropdown.querySelector('.sort-trigger').addEventListener('click', e => {
  e.stopPropagation();
  dropdown.classList.toggle('open');
});
dropdown.querySelectorAll('.sort-option').forEach(opt => {
  opt.addEventListener('click', () => {
    label.textContent = opt.textContent;
    dropdown.querySelectorAll('.sort-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    dropdown.classList.remove('open');
  });
});
document.addEventListener('click', () => dropdown.classList.remove('open'));
```

Key details: `stopPropagation` on the trigger prevents the `document` listener from immediately closing the menu on open; `right: 0` aligns the menu to the right edge of the trigger so it doesn't clip off-screen.

## Data values vs design values

Swatch colors are **data**, not design — each circle has its own color value that will come from app logic. Use inline `style="background: #2E71D6"` on each swatch element rather than a CSS class, so the CSS only defines shape/border behavior and the colors remain easy to edit as data.

## Exclusive parent/child hover states

When a child element (e.g. a scrubber thumb) is hovered, the parent (e.g. seek track) should suppress its own hover highlight — otherwise both light up simultaneously. Use `:has()`:

```css
.seek-track:hover:not(:has(.seek-thumb:hover)) { background: #515151; }
```

Also ensure the thumb has `z-index: 1` so it always renders above sibling fill bars, and remove `pointer-events: none` so it can receive its own `:hover`.

## Play icon optical centering

The ▶ glyph renders visually left-of-center inside a flex-centered container. Add `padding-left: 2px` to the button to compensate. Same issue applies to other asymmetric glyphs (◀, ▲, ▼).

## Testing setup

- Set `body { background: #facade; min-height: 100vh; padding: 16px; }` so the panel is visible against the page.
- Make the root frame element `display: flex; flex-direction: column` so stacked sections (content + actions) lay out correctly.
