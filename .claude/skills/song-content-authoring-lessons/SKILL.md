---
name: song-content-authoring-lessons
description: Known gotchas/techniques for transcribing source material (sheet music, tab) into this project's chart JSON format — check before writing or editing lead.json/bass.json/keys.json/song.json/arrangement.json content.
allowed-tools: Read
---

# Song content authoring lessons

Before transcribing source material into a song's chart JSON, or editing an existing song's
`song.json`/`lead.json`/`arrangement.json` (duration, sections, notes), read
`Analysis/lessons/song-content-authoring.md` in full — it's six entries, short enough to
read whole rather than index into.

## How to use this skill

1. Read `Analysis/lessons/song-content-authoring.md`.
2. These cover the current recommended path (notate in TuxGuitar, export `.gp5`, convert via
   RockyRoadImport — see that repo's README, not this one, for the how-to), why hand-authoring
   JSON from a tab image/PDF was never reliable (archived CSV-dictation example, historical), the
   `String` field's indexing convention, and using total-duration arithmetic and key-signature
   diatonicity as free correctness checks on any chart's data, plus keeping a song folder's files
   (and the shared `public/songs/manifest.json`) in sync.
3. If you hit a new gotcha in this category, add it here — see
   `Analysis/lessons/README.md` for the full filing rule and CLAUDE.md for comment-length
   style. If the file grows past ~15 entries, it graduates to its own directory (same shape as
   `ui-toolkit/`), per the README's own size-split rule.
