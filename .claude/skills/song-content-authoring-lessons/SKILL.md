---
name: song-content-authoring-lessons
description: Known gotchas/techniques for transcribing source material (sheet music, tab) into this project's chart JSON format — check before writing or editing lead.json/bass.json/keys.json/song.json/arrangement.json content.
allowed-tools: Read
---

# Song content authoring lessons

Before transcribing source material into a song's chart JSON, or editing an existing song's
`song.json`/`lead.json`/`arrangement.json` (duration, sections, notes), read
`Analysis/lessons/song-content-authoring.md` in full — it's seven entries, short enough to
read whole rather than index into.

## How to use this skill

1. Read `Analysis/lessons/song-content-authoring.md`.
2. These cover why image/PDF tab parsing isn't reliable enough to attempt (ask for CSV dictation
   instead), the `String` field's indexing convention, converting dictated note durations to
   seconds, using total-duration arithmetic and key-signature diatonicity as free correctness
   checks on transcribed data, generating bulk chart JSON via script rather than by hand, and
   keeping a song folder's files (plus the shared `public/songs/manifest.json`) in sync.
3. If you hit a new gotcha in this category, add it here — see
   `Analysis/lessons/README.md` for the full filing rule and CLAUDE.md for comment-length
   style. If the file grows past ~15 entries, it graduates to its own directory (same shape as
   `ui-toolkit/`), per the README's own size-split rule.
