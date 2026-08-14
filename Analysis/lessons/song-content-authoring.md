# Song content authoring — transcribing source material into chart JSON

Gotchas and techniques from converting external notation (sheet music, guitar tab) into this
app's chart JSON format (`lead.json`/`bass.json`/etc). See [`README.md`](README.md) for how
entries get routed here vs. elsewhere. Not about uikit/engine internals — about the *data* these
render, and the authoring workflow that produces it.

---

## Claude's default image/PDF parsing isn't accurate enough for guitar-tab digit-level transcription — CSV dictation is the working fallback

**Finding:** Reading fret/string digits directly off a tab image or PDF — even from a clean,
zoomed, user-provided crop of just a few measures — produced outright wrong digits, not just
ambiguous readings (confirmed by the user checking against the source). See
`feedback_no_tab_image_parsing` in persistent memory for that finding itself. What actually
worked: the user hand-transcribed each measure into a CSV, one measure per block, rows = the 6 tab
strings (1 = highest), columns = note slots within the measure, cell = `fret, note-value` (blank =
no note on that string/slot). E.g. measure 24 of a "held note resolves, then a new note" measure:

```
Measure 24,Note 1,Note 2,Note 3
Tab Strings,,,
1,,,
2,,,
3,"2, 0.5 (end hold)",,
4,,"0, 0.25",
5,,,
6,,,
```

`(end hold)` / `(start hold)` suffixes on the value mark a note tied across the barline (see the
duration-conversion entry below for how these get merged into one note object). This arrangement
had no chords — every note slot had at most one string filled — so this format's handling of
genuinely simultaneous multi-string notes is unexercised; revisit if a future transcription needs
it.

**Unexplored:** dedicated music-notation/guitar-tab OCR tooling as a possible intermediary, to
turn a source PDF into structured data directly instead of needing manual CSV dictation for every
future transcription. Worth investigating before the next one of these comes up.

---

## `SongNote.String` is 0-indexed low-to-high, not the 1-indexed high-to-low convention tab notation uses

**Finding:** `String: 0` = low E (thickest), `String: 5` = high e (thinnest) — opposite direction
and off-by-one from how guitar tab is normally read/labeled (tab's "string 1" is the highest, top
line). Confirmed from this codebase's own runtime logic (`NoteDetector.ts`'s
`STANDARD_BASE_NOTES[6][note.String]` indexing, cross-checked against `FretPlayerScene3D.ts`'s
render-height ordering) since the original C# source isn't checked out in this repo to consult
directly.

**How to apply:** When transcribing from tab (string 1 = high e on top), convert via
`appString = 6 - tabStringNumber` before writing `String` into the JSON.

---

## Note durations dictated as fraction-of-whole-note need converting to seconds via the song's actual BPM

**Finding:** The most reliable way to get duration data out of a human transcribing a tab by hand
is fraction-of-whole-note (0.25=quarter, 0.5=half, 0.125=eighth, 0.375=dotted quarter, 0.75=dotted
half) — matches how musicians already think about note values, unlike literal seconds. Convert via
`seconds = fraction × 4 × (60 / BPM)`.

**How to apply:** Get BPM and time signature from the source (or the audio track) before
transcribing anything — every other time computation depends on it.

---

## Total song duration is a free, powerful sanity check before trusting any note-level data

**Finding:** `measureCount × beatsPerMeasure × secondsPerBeat` should equal the track's actual
length almost exactly. For a piece with a pickup (anacrusis), the *final* measure is conventionally
shortened by the same beat count the pickup borrowed — confirmed here when 32 measures × 3 beats ×
0.5s (120 BPM) landed on exactly 48.0s, matching the given track length, with the last measure's
notation showing only 2 beats instead of 3.

**How to apply:** Do this arithmetic check *before* transcribing note-by-note — a mismatch means a
wrong BPM, a miscounted measure, or a missed pickup/anacrusis, all worth fixing before the fine
detail work.

---

## A known key signature makes most fret/string transcription errors self-evident, for free

**Finding:** Given standard tuning and a diatonic key, only certain (open-string-pitch, fret)
combinations land in-key — e.g. fret 1 is diatonic on the B string (→C) but not on any of the
other 5 strings in G major. Cross-checking transcribed (String, Fret) pairs against this caught a
real mistranscription (two measures had their string numbers swapped) before it reached the chart.

**How to apply:** Before trusting a batch of tab-derived (string, fret) data, check each pair
against the song's key signature — an off-key result is a strong signal of a swapped string or
misread digit, worth flagging back to whoever transcribed it rather than assuming it's a deliberate
chromatic passing tone.

---

## Script-generate bulk chart JSON from a compact source table instead of hand-authoring each note object

**Finding:** A ~30-second chart is 70-90+ individual note objects with precise cumulative timing —
hand-typing that risks silent arithmetic drift. Encoding the source data (string/fret/duration per
measure, as dictated) into a small array and writing a script to compute cumulative
`TimeOffset`/`TimeLength`/`EndTime` (and merge tied/held notes across barlines into one note object)
is far safer, and its output is cheap to sanity-check (total note count, final `EndTime`, spot-check
specific notes) before writing the real file.

---

## A song folder's JSON files (and the shared songs manifest) all need to move together when a chart's duration/structure changes

**Finding:** `song.json`'s `SongLengthSeconds`, `lead.json`'s `Sections`/`Notes`, and
`arrangement.json`'s `Sections`/`Beats` all encode duration/structure independently — changing one
(e.g. re-transcribing to a longer arrangement) without the others leaves them silently inconsistent.
`public/songs/manifest.json` is a further, easy-to-forget one-level-up file: it's what `BakedSource`
("Demo Songs") uses to discover which songs exist at all, so a song folder that's otherwise complete
still won't appear there without its own entry.

**How to apply:** Treat a duration or section-structure change as touching all three per-song files
plus a check of whether the song has (or should have) an entry in the shared manifest — not just the
one file that was directly edited.
