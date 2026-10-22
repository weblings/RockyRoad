# ui-toolkit lessons — index

Gotchas from the `PanelUI`/`@pmndrs/uikit`/`.uikitml` migration and everything built on it since.
Filed by activity/task-type. Check the file(s) matching what you're about to do before writing or
editing `.uikitml` or XR panel/dropdown/screen code.

| File | Scope | Entries | File here when |
|---|---|---|---|
| [syntax-and-styling.md](syntax-and-styling.md) | `.uikitml` markup/CSS-like property gotchas: no shorthand, flex-container defaults, button centering, `classList`, `border-radius`, no CSS Grid, `UIKit.*` constructor shape, silently-unmatched classes, `flex-grow: 1` centered content auto-adapting to a new sibling, explicit width for a text column in a card | 11 | markup or style property behavior |
| [text-rendering.md](text-rendering.md) | fonts/glyphs/wrapping: `inter` weights, text-burst layout corruption, missing glyphs, empty-element `setProperties`, multi-styled text, `whiteSpace` vs. `wordBreak`, the unresolved cross-subtree wrap bug | 7 | fonts, glyphs, or text layout |
| [panels-visibility-lifecycle.md](panels-visibility-lifecycle.md) | show/hide, interactivity gating, multi-panel coordination: two-gate hiding, fake `disabled`, `pointerEvents` timing race, Y-offset sizing, dead loading-state code, centralized hide logic, completion-callback shape, skip-confirmation-when-nothing-to-confirm, sibling-interactivity ownership | 9 | showing/hiding panels or gating interactivity |
| [scrolling-and-dropdowns.md](scrolling-and-dropdowns.md) | `overflow: scroll` behavior, scrollbar defaults, pointer-capture wedging, `OptionDropdown`'s `render()`/`renderDynamic()` split, the two unresolved dropdown bugs, stale `event.object` identity mid-bubble, sizing a short menu to its options, the shared was-scrolled flag stopping long XR lists, Images not clipping when straddling an edge | 12 | scroll containers or dropdown menus |
| [pointer-interaction.md](pointer-interaction.md) | `Hovered`, drag math (`worldToLocal(event.point)`), `setPointerCapture`/`releasePointerCapture`, `pointerEvents` inheritance, slider hit area and thumb margins, a scroll drag ending in a card click | 6 | ray/hand drag, hover, or capture |
| [assets-tooling-debugging.md](assets-tooling-debugging.md) | SVG icons, `.uikitml`→JSON caching, missing-image handling, `currentColor`, `compileUIKit` missing-dir crash, `Image`'s `keepAspectRatio`, `Svg`'s fill-only rendering, SVG `width`/`height` for `TextureLoader`, no gradients or image tint | 9 | icons/images, the compile pipeline, or uikit debugging workflow |

Counts as of 2026-10-22 — bump when adding entries.

## Cross-listed (touches more than one topic)

- **`pointerEvents: 'auto'` set before `PanelDocument` exists silently no-ops forever** — filed
  under `panels-visibility-lifecycle.md` (it's a lifecycle-timing bug), but the same race applies
  to any interactivity toggle, not just hide/show.
- **Missing-glyph character set** (`text-rendering.md`) and **`currentColor` breaking the SVG
  loader** (`assets-tooling-debugging.md`) are the same underlying category — "check unfamiliar
  characters/attributes before shipping, not after a bug report" — cross-referenced in both files.
