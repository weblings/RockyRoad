# Song content authoring — transcribing source material into chart JSON

Gotchas and techniques from converting external notation (sheet music, guitar tab) into this
app's chart JSON format (`lead.json`/`bass.json`/etc). See [`README.md`](README.md) for how
entries get routed here vs. elsewhere. Not about uikit/engine internals — about the *data* these
render, and the authoring workflow that produces it.

---

## Recommended path: notate in TuxGuitar, export GP5, convert via RockyRoadImport

Hand-authoring chart JSON from a tab (below) is superseded — see
[`RockyRoadImport/README.md`](../../../RockyRoadImport/README.md#converting-guitar-pro-gp3gp4gp5-files)
for the current recommended workflow (notate in TuxGuitar, export `.gp5`, convert with
RockyRoadImport's Guitar Pro tab). That tool's `gpConverter.ts` already handles string-indexing,
duration-to-seconds conversion, and JSON generation, so the manual techniques below are mostly
historical now.

---

## Claude's default image/PDF parsing isn't accurate enough for guitar-tab digit-level transcription

**Finding:** Reading fret/string digits directly off a tab image or PDF — even from a clean,
zoomed, user-provided crop of just a few measures — produced outright wrong digits, not just
ambiguous readings (confirmed by the user checking against the source). See
`feedback_no_tab_image_parsing` in persistent memory. This is why the TuxGuitar path above exists —
a human notating directly in a real tab editor sidesteps the problem rather than working around it.

**Historical, archived for reference:** before GP5 support existed, the working fallback was
hand-transcribing each measure into a CSV — rows = the 6 tab strings (1 = highest), columns = note
slots, cell = `fret, note-value` (blank = no note). E.g. measure 24 of a "held note resolves, then a
new note" measure:

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

`(end hold)` / `(start hold)` suffixes marked a note tied across the barline. This never got
exercised against a chord (every note slot had at most one string filled).

---

## `SongNote.String` is 0-indexed low-to-high, not the 1-indexed high-to-low convention tab notation uses

**Finding:** `String: 0` = low E (thickest), `String: 5` = high e (thinnest) — opposite direction
and off-by-one from how guitar tab is normally read/labeled (tab's "string 1" is the highest, top
line). Confirmed from this codebase's own runtime logic (`NoteDetector.ts`'s
`STANDARD_BASE_NOTES[6][note.String]` indexing, cross-checked against `FretPlayerScene3D.ts`'s
render-height ordering) since the original C# source isn't checked out in this repo to consult
directly.

The GP5 path handles this conversion automatically (`gpConverter.ts`) — this only matters now if
hand-editing a `lead.json`/`bass.json` directly: `appString = 6 - tabStringNumber`.

---

## Total song duration is a free, powerful sanity check on any chart, regardless of source

**Finding:** `measureCount × beatsPerMeasure × secondsPerBeat` should equal the track's actual
length almost exactly. For a piece with a pickup (anacrusis), the *final* measure is conventionally
shortened by the same beat count the pickup borrowed — confirmed here when 32 measures × 3 beats ×
0.5s (120 BPM) landed on exactly 48.0s, matching the given track length, with the last measure's
notation showing only 2 beats instead of 3.

**How to apply:** Check a chart's total duration against the real track length before trusting it —
still useful as a cheap catch for a wrong BPM/time-signature baked into a source file (TuxGuitar or
otherwise), not just hand-transcribed data.

---

## A known key signature makes most fret/string errors self-evident, for free

**Finding:** Given standard tuning and a diatonic key, only certain (open-string-pitch, fret)
combinations land in-key — e.g. fret 1 is diatonic on the B string (→C) but not on any of the
other 5 strings in G major. Cross-checking (String, Fret) pairs against this caught a real
mistranscription (two measures had their string numbers swapped) before it reached the chart.

**How to apply:** Less critical now that notation happens in a real tab editor with audio playback
rather than blind CSV cell-typing, but still a cheap check on any chart's (String, Fret) data — an
off-key result is a strong signal of a swapped string or encoding mistake worth investigating.

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
