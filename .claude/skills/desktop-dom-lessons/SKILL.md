---
name: desktop-dom-lessons
description: Known browser DOM/CSS/event gotchas from this project's desktop screens — check before writing or editing src/desktop/ markup, CSS, or component/event-wiring code.
allowed-tools: Read, Grep
---

# Desktop DOM/CSS lessons

Before writing or editing `src/desktop/` markup, CSS (`desktop.html`'s `<style>` block), or
DOM-component/event-wiring code, check `docs/lessons/desktop-dom.md` —
each has `Tags:`/`Applies-when:` lines for retrieval.

## How to use this skill

1. Grep `Tags:`/`Applies-when:` in `docs/lessons/desktop-dom.md` for the task at hand;
   read only matching entries in full.
2. These are browser-native DOM/CSS/event-model facts specific to this project's own desktop
   components (not XR/uikit — see `uikit-lessons` — and not IWSDK/Three.js — see
   `xr-engine-lessons`). Several document silent failures (a selector that matches nothing, a
   hidden element that still claims layout space, a spacing rule that quietly collapses) — check
   whether the current task rhymes with one before writing the change.
3. If you hit a new gotcha in this category, add it here — see
   `docs/lessons/README.md` for the full filing rule and CLAUDE.md for comment-length
   style. If the file grows past ~15 entries, it graduates to its own directory (same shape as
   `ui-toolkit/`), per the README's own size-split rule.
