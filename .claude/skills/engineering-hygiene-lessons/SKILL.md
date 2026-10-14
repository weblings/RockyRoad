---
name: engineering-hygiene-lessons
description: Design hygiene lessons — check before deleting/modifying shared global state, extending a data model consumed in multiple places, reusing an existing broad function for a narrower purpose, or building a new component/resize behavior with no sketch reference.
allowed-tools: Read, Grep
---

# Engineering hygiene lessons

Before deleting or modifying shared global state, extending a data model that's consumed in
multiple places, gating async work on a live condition, or reusing an existing "does everything"
function/helper for a narrower purpose, check
`docs/lessons/engineering-hygiene.md` — 21 entries, each with `Tags:`/`Applies-when:`
lines for retrieval.

## How to use this skill

1. Grep `Tags:`/`Applies-when:` in `docs/lessons/engineering-hygiene.md` for the task at
   hand; read only matching entries in full, never the whole file.
2. These are general software-design principles (not tied to any one library), each demonstrated
   via a real bug hit in this codebase — check whether the current task rhymes with one of them
   before writing the change.
3. If you hit a new general design-hygiene lesson (not really about a specific library/API, more
   about *how* the change was structured), add it here rather than to `ui-toolkit/` or `engine/` —
   see `docs/lessons/README.md` for the full filing rule. If the lesson is instead
   about your own verification/investigation habits rather than code design, it belongs in
   `bd remember`, not this file.
