---
name: uikit-lessons
description: Known uikit/uikitml/PanelUI gotchas — check before writing or editing .uikitml files or XR panel/dropdown/screen code.
allowed-tools: Read, Grep, Glob
---

# uikit/uikitml lessons

Before writing or editing a `.uikitml` file, or any XR panel/dropdown/screen TypeScript code
(`src/xr/**`), check `Analysis/lessons/ui-toolkit/INDEX.md` — it summarizes each topic
file's contents in one bullet list, no need to open every file.

## How to use this skill

1. Read `Analysis/lessons/ui-toolkit/INDEX.md`.
2. Match the current task against its bullets — by activity (writing markup/CSS-like properties,
   text content, panel show/hide, scrolling/dropdowns, drag/pointer handling, icons/assets) rather
   than by which screen you're on.
3. Read only the matching sub-file(s) in full before proceeding. Don't skip this because the task
   "seems simple" — many of these gotchas fail completely silently (no error, no warning), which
   is exactly why they're recorded here instead of being rediscoverable by testing alone.
4. If you hit a new gotcha not covered there, add it to the matching topic file (or create a new
   topic file if none fits) following the format already used — see
   `Analysis/lessons/README.md` for the filing rule, and `CLAUDE.md` for comment-length
   style (keep entries tight, not paragraph-long essays, unless the context genuinely can't
   survive compression).
