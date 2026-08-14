# Lessons learned — index and filing rules

Gotchas, non-obvious findings, and hard-won decisions that aren't obvious from reading the code or
planning docs. Add here whenever something costs more than 30 minutes to diagnose.

## Where a lesson lives

1. Is this about *my own* verification/reliability habits, not code or design? → persistent memory
   (`feedback_*`), not the repo.
2. Is this a general software-design principle, demonstrated by a real bug here? →
   [`engineering-hygiene.md`](engineering-hygiene.md).
3. Otherwise, uikit/uikitml/PanelUI? → `ui-toolkit/<topic>.md` (see
   [`ui-toolkit/INDEX.md`](ui-toolkit/INDEX.md)), topic chosen by activity: syntax, text,
   panel-lifecycle, scrolling, pointer, assets/tooling.
4. Otherwise → `engine/<topic>.md` (see [`engine/INDEX.md`](engine/INDEX.md)): runtime-apis /
   xr-3d-rendering / dev-environment.
5. Cross-cutting entry (touches two systems)? File it under whichever system *constrains the fix*,
   not whichever system exhibited the symptom — e.g. "`THREE.Sprite` crashes IWSDK's pointer
   system" lives under `engine/runtime-apis.md` because the fix is "don't use `Sprite` in an
   IWSDK-managed scene graph," not something wrong with `Sprite` itself. Cross-list it under every
   relevant heading in that directory's `INDEX.md` if genuinely two-sided — content lives once,
   discovery can point from multiple angles.

## Directory map

```
lessons/
  README.md               # this file
  engineering-hygiene.md  # design principles demonstrated via a real bug here
  ui-toolkit/              # uikit/uikitml/PanelUI — see INDEX.md
  engine/                  # IWSDK/Three.js/Web Audio + dev/XR environment — see INDEX.md
```

## Skills

Three skills route to this tree — `uikit-lessons`, `xr-engine-lessons`,
`engineering-hygiene-lessons` (see `.claude/skills/`). They're not slash commands; check them
against whatever you're about to touch and invoke the matching one yourself, same as any skill.
