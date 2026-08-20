---
name: xr-engine-lessons
description: Known IWSDK/Three.js/XRProto rendering and dev-environment gotchas — check before touching XR scene graph, input, rendering internals, or build/dev setup.
allowed-tools: Read, Grep, Glob
---

# Engine (IWSDK / Three.js / dev-environment) lessons

Before touching XR scene graph or input code, rendering-internals code (coordinate math, batching,
scene lifecycle), or Vite/build/dev-server setup, check
`Analysis/lessons/engine/INDEX.md` — it summarizes each topic file's contents in one
bullet list, no need to open every file.

## How to use this skill

1. Read `Analysis/lessons/engine/INDEX.md`.
2. Match the current task against its bullets — by activity (a third-party IWSDK/Three.js/Web
   Audio API fact you need, this project's own coordinate/rendering internals, or dev-environment/
   debugging setup) rather than by which screen you're on.
3. Read only the matching sub-file(s) in full before proceeding. Several entries here document
   silent failures (wrong axis convention, a frame-rate crater with no error, a component reset
   every frame overriding your own write) that are much cheaper to check for up front than to
   re-diagnose from scratch.
4. If you hit a new gotcha not covered there, add it to the matching topic file following the
   format already used — see `Analysis/lessons/README.md` for the filing rule, and
   `CLAUDE.md` for comment-length style.
