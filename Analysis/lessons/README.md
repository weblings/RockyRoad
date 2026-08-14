# Lessons learned — index and filing rules

Gotchas, non-obvious findings, and hard-won decisions that aren't obvious from reading the code or
planning docs. Add here whenever something costs more than 30 minutes to diagnose.

**This directory is the only lessons-learned location in the repo** — for every subproject, not
just `ThreeCP/Analysis/` itself. Don't start a new `LessonsLearned.md` elsewhere; if unsure whether
one already exists, `find . -iname "*lesson*"` first.

## Index

- [`engineering-hygiene.md`](engineering-hygiene.md) — general design principles, small enough to
  read whole, no sub-index needed.
- [`desktop-dom.md`](desktop-dom.md) — browser-native DOM/CSS/event gotchas from `src/desktop/`,
  small enough to read whole, no sub-index needed.
- [`song-content-authoring.md`](song-content-authoring.md) — transcribing source material
  (sheet music, tab) into chart JSON: `String` indexing, duration/tempo conversion, diatonic
  cross-checking, keeping a song folder's files in sync. Small enough to read whole.
- [`ui-toolkit/INDEX.md`](ui-toolkit/INDEX.md) — uikit/uikitml/PanelUI, by activity.
- [`engine/INDEX.md`](engine/INDEX.md) — IWSDK/Three.js/Web Audio + dev/XR environment, by activity.

## Where a new lesson goes

1. About *my own* verification/reliability habits, not code/design? → persistent memory
   (`feedback_*`), not the repo.
2. General software-design principle, demonstrated by a real bug here? → `engineering-hygiene.md`.
3. uikit/uikitml/PanelUI? → `ui-toolkit/<topic>.md`, topic chosen by activity.
4. Browser-native DOM/CSS/JS event behavior, `src/desktop/` specifically? → `desktop-dom.md`.
5. Transcribing/authoring song chart content (not the code that renders it)? →
   `song-content-authoring.md`.
6. Otherwise → `engine/<topic>.md`, topic chosen by activity.
7. Cross-cutting entry? File under whichever system *constrains the fix*, not whichever exhibited
   the symptom — e.g. `THREE.Sprite` crashing IWSDK's pointer system files under
   `engine/runtime-apis.md`, not a Sprite-specific file. Cross-list in that directory's `INDEX.md`
   if genuinely two-sided.
8. Destination file too long to skim (rough proxy: 15+ entries)? Split along a finer cut of the
   same activity razor, into a new sibling file (or, once one of the flat files crosses that
   threshold, a directory of its own — same shape as `ui-toolkit/`/`engine/`). Then update: that
   file's own index if it's a directory, any other lesson entry or code comment pointing at the old
   filename, and this list if it names it. Skills route via `INDEX.md` (or the file directly, for
   the flat ones), never a hardcoded filename, so they shouldn't need touching — confirm rather
   than assume.

Tied to now-removed code? Keep the principle if it still applies, drop the dead specifics, and
say the origin is historical — see `engineering-hygiene.md`'s async-gating entry for a worked
example, genericized from the removed html2canvas pipeline.

## Skills

Five skills route to this tree — `uikit-lessons`, `xr-engine-lessons`, `desktop-dom-lessons`,
`engineering-hygiene-lessons`, `song-content-authoring-lessons` (see `.claude/skills/`). Not slash
commands; check them against whatever you're about to touch and invoke the matching one yourself.
