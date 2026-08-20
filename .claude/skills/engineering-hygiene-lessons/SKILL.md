---
name: engineering-hygiene-lessons
description: Design hygiene lessons — check before deleting/modifying shared global state, extending a data model consumed in multiple places, or reusing an existing broad function for a narrower purpose.
allowed-tools: Read
---

# Engineering hygiene lessons

Before deleting or modifying shared global state, extending a data model that's consumed in
multiple places, gating async work on a live condition, or reusing an existing "does everything"
function/helper for a narrower purpose, read
`Analysis/lessons/engineering-hygiene.md` in full — it's five entries, short enough to
read whole rather than index into.

## How to use this skill

1. Read `Analysis/lessons/engineering-hygiene.md`.
2. These are general software-design principles (not tied to any one library), each demonstrated
   via a real bug hit in this codebase — check whether the current task rhymes with one of them
   before writing the change.
3. If you hit a new general design-hygiene lesson (not really about a specific library/API, more
   about *how* the change was structured), add it here rather than to `ui-toolkit/` or `engine/` —
   see `Analysis/lessons/README.md` for the full filing rule. If the lesson is instead
   about your own verification/investigation habits rather than code design, it belongs in
   persistent cross-session memory (`feedback_*`), not this file.
