---
name: desktop-dom-lessons
description: Known browser DOM/CSS/event gotchas from this project's desktop screens — check before writing or editing src/desktop/ markup, CSS, or component/event-wiring code.
allowed-tools: Read
---

# Desktop DOM/CSS lessons

Before writing or editing `src/desktop/` markup, CSS (`desktop.html`'s `<style>` block), or
DOM-component/event-wiring code, read `Analysis/lessons/desktop-dom.md` in full — it's
four entries, short enough to read whole rather than index into.

## How to use this skill

1. Read `Analysis/lessons/desktop-dom.md`.
2. These are browser-native DOM/CSS/event-model facts specific to this project's own desktop
   components (not XR/uikit — see `uikit-lessons` — and not IWSDK/Three.js — see
   `xr-engine-lessons`). Several document silent failures (a selector that matches nothing, a
   hidden element that still claims layout space, a spacing rule that quietly collapses) — check
   whether the current task rhymes with one before writing the change.
3. If you hit a new gotcha in this category, add it here — see
   `Analysis/lessons/README.md` for the full filing rule and CLAUDE.md for comment-length
   style. If the file grows past ~15 entries, it graduates to its own directory (same shape as
   `ui-toolkit/`), per the README's own size-split rule.
