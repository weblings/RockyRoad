# Song content authoring — transcribing source material into chart JSON

Id: lesson-song-content-authoring

Gotchas and techniques from converting external notation (sheet music, guitar tab) into this
app's chart JSON format (`lead.json`/`bass.json`/etc). See [`README.md`](README.md) for how
entries get routed here vs. elsewhere. Not about uikit/engine internals — about the *data* these
render, and the authoring workflow that produces it.

---

## Recommended path: notate in TuxGuitar, export GP5, convert via RockyRoadImport
Tags: tuxguitar, gp5, rockyroadimport, workflow
Applies-when: starting to author a new song chart from tab or sheet music

Hand-authoring chart JSON from a tab (below) is superseded — see
[`RockyRoadImport/README.md`](../../../RockyRoadImport/README.md#converting-guitar-pro-gp3gp4gp5-files)
for the current recommended workflow (notate in TuxGuitar, export `.gp5`, convert with
RockyRoadImport's Guitar Pro tab). That tool's `gpConverter.ts` already handles string-indexing,
duration-to-seconds conversion, and JSON generation, so the manual techniques below are mostly
historical now.

---

## Claude's default image/PDF parsing isn't accurate enough for guitar-tab digit-level transcription
Tags: tab, image-parsing, transcription, csv
Applies-when: asked to read fret/string digits off a tab image or PDF

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
Tags: string-index, tab, lead-json, bass-json
Applies-when: hand-editing String values in a chart or converting tab string numbers

**Finding:** `String: 0` = low E (thickest), `String: 5` = high e (thinnest) — opposite direction
and off-by-one from how guitar tab is normally read/labeled (tab's "string 1" is the highest, top
line). Confirmed from this codebase's own runtime logic (`NoteDetector.ts`'s
`STANDARD_BASE_NOTES[6][note.String]` indexing, cross-checked against `FretPlayerScene3D.ts`'s
render-height ordering) since the original C# source isn't checked out in this repo to consult
directly. `STANDARD_BASE_NOTES[6]` itself lives in `SongIndex.ts`:

```
String 0 = E2 (MIDI 40)   ← low E (bottom line of tab)
String 1 = A2
String 2 = D3
String 3 = G3
String 4 = B3
String 5 = E4              ← high e (top line of tab)
```

The GP5 path handles this conversion automatically (`gpConverter.ts`) — this only matters now if
hand-editing a `lead.json`/`bass.json` directly: `appString = 6 - tabStringNumber`.

---

## A deprecated converter can emit syntactically-valid but semantically-empty data — cross-check against a known-good chart, don't guess
Tags: hand-fret, chart-data, converter, validation
Applies-when: a chart field looks valid but behaves as if constant, or setting HandFret by hand

**Finding:** `home-on-the-range` (CSV pipeline) had `HandFret` hardcoded to `0` on every note — a
valid-looking field, never actually computed, so the hand-position highlight never moved.

**How to apply:** Diff against a real chart (LochLomond) to find the rule instead of guessing:
`HandFret` matches the note's own `Fret`, carried forward through open-string notes — but only
move it when the new fret actually falls outside the current `[HandFret-1, HandFret+3]` window,
not on every fretted note. A passing note already in reach should keep the existing hand position
rather than jump to match it and immediately jump back — otherwise the camera/highlight flickers
for no reason.

---

## Total song duration is a free, powerful sanity check on any chart, regardless of source
Tags: duration, bpm, time-signature, validation, pickup
Applies-when: validating a chart's tempo/time signature against the real track length

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
Tags: key-signature, validation, tab, transcription
Applies-when: checking (String, Fret) data or reading an ambiguous tab digit

**Finding:** Given standard tuning and a diatonic key, only certain (open-string-pitch, fret)
combinations land in-key — e.g. fret 1 is diatonic on the B string (→C) but not on any of the
other 5 strings in G major. Cross-checking (String, Fret) pairs against this caught a real
mistranscription (two measures had their string numbers swapped) before it reached the chart.

**How to apply:** Less critical now that notation happens in a real tab editor with audio playback
rather than blind CSV cell-typing, but still a cheap check on any chart's (String, Fret) data — an
off-key result is a strong signal of a swapped string or encoding mistake worth investigating.
Same check resolves an ambiguous digit when reading a tab photo: list the legal scale notes per
string in first position and rule out illegal readings. In open-position G major, a `1` near the B
string line is almost always C4 (the IV chord), which makes it a reliable visual anchor.

---

## A song folder's JSON files (and the shared songs manifest) all need to move together when a chart's duration/structure changes
Tags: song-json, arrangement-json, manifest, sections
Applies-when: changing a chart's duration or section structure, or adding a new song folder

**Finding:** `song.json`'s `SongLengthSeconds`, `lead.json`'s `Sections`/`Notes`, and
`arrangement.json`'s `Sections`/`Beats` all encode duration/structure independently — changing one
(e.g. re-transcribing to a longer arrangement) without the others leaves them silently inconsistent.
`public/songs/manifest.json` is a further, easy-to-forget one-level-up file: it's what `BakedSource`
("Demo Songs") uses to discover which songs exist at all, so a song folder that's otherwise complete
still won't appear there without its own entry.

**How to apply:** Treat a duration or section-structure change as touching all three per-song files
plus a check of whether the song has (or should have) an entry in the shared manifest — not just the
one file that was directly edited.

---

## Hand-authored chart JSON needs three inputs — tab, rhythm, and tempo — before any note can be written
Tags: timing, bpm, tab, sheet-music, hand-authoring
Applies-when: hand-authoring chart JSON without the GP5 path

**Finding:** Tab gives fret/string but no time; sheet music gives relative durations but no
tempo. `TimeOffset`/`TimeLength` are in seconds, so you need fret+string (tab), duration in beats
(sheet music), and BPM (metronome marking or by ear). Missing any one means guessing a dimension.

**How to apply:** The GP5 path carries all three; this only matters when hand-authoring. Collect
all three before writing any JSON.

---

## A pickup (anacrusis) shifts every later bar timing by the pickup's length
Tags: pickup, anacrusis, timing, arrangement-json, measures
Applies-when: computing bar/measure timings for a song that starts with a pickup

**Finding:** In 3/4 at 80 BPM with a 1-beat pickup at t=0.00, bar 1's downbeat is t=0.75, not 0.00;
bar N is `0.75 + (N−1) × 2.25`. Getting this wrong offsets every `IsMeasure: true` beat in
`arrangement.json`, so bar lines fall between notes instead of on them.

**How to apply:** Start the bar grid at the pickup's end, not t=0. See the total-duration entry
above for the matching shortened final measure.

---

## Repeated melodic phrases cut hand-encoding work and catch errors by symmetry
Tags: hand-authoring, phrases, verification
Applies-when: hand-encoding a song with repeated verse lines

**Finding:** Folk/traditional songs often reuse one phrase across verse lines (AABB/ABAB) — "Home on
the Range" shares lines 1 & 3 and lines 2 & 4. Encoding one line and duplicating it with shifted
`TimeOffset`s halves the work, and comparing the copies flags a wrong note in either.

**How to apply:** Identify the phrase structure before encoding; diff equivalent notes across
repeats when something looks off.

---

## A rest between phrases is encoded as no notes, never a filler note
Tags: rests, notes, hand-authoring
Applies-when: encoding silence between phrases in a chart

**Finding:** "Home on the Range" has 1.5s with no notes between lines. The highway scrolls through
empty time naturally; a phantom note added to "fill" the gap shows a spurious fret indicator.

**How to apply:** Leave the gap empty in `Notes`.

---

## A chart with no audio still scrolls, so timing can be checked visually before audio exists
Tags: audio, song-ogg, verification, song-player
Applies-when: verifying a chart's timing before audio exists

**Finding:** `SongPlayer.play()` runs as a pure timer with no buffer loaded (see the "Charts without
`song.ogg` freeze the highway" entry in `engine/xr-3d-rendering.md`). A hand-authored demo chart's
timing can be verified by watching notes cross the now-line before sourcing any audio.

**How to apply:** Check chart timing silently first; source or generate audio after.
