# Lessons Learned: Translating Tabs and Sheet Music to Open Song Chart

From the "Home on the Range" encoding experiment. Applies to any attempt to hand-author chart data from human-readable music notation.

---

## The format needs timing; tabs and sheet music encode it differently

A guitar tab gives you fret and string positions but no absolute time. Sheet music gives you relative durations (quarter note, half note) but no tempo. The JSON format needs `TimeOffset` and `TimeLength` in seconds — so you need both, plus a BPM.

**What you need before you can start writing JSON:**
1. Fret + string for every note (from tab)
2. Note duration in beats (from sheet music rhythmic notation)
3. Tempo in BPM (from a metronome marking or by ear)

Without all three you're guessing at least one dimension.

---

## String numbering is counterintuitive: 0 = low E, 5 = high e

Standard guitar tab notation draws the high e string at the top of the staff and low E at the bottom. The JSON format uses the opposite index convention: `String: 0` = low E (thickest), `String: 5` = high e (thinnest). Always confirm against `STANDARD_BASE_NOTES[6]` in `SongIndex.ts`:

```
String 0 = E2 (MIDI 40)   ← low E (bottom line of tab)
String 1 = A2
String 2 = D3
String 3 = G3
String 4 = B3
String 5 = E4              ← high e (top line of tab)
```

When reading a tab image, the visual top → bottom maps to String 5 → String 0.

---

## Reading tab fret numbers from a photo is error-prone; musical theory fills the gap

When working from a scanned or photographed tab, fret numbers on specific strings are easy to misread — the vertical position of a digit relative to the six staff lines is ambiguous at normal image resolution. The reliable fallback is:

1. Identify the key (from the key signature or chord symbols)
2. List the legal scale notes on each string in first position
3. Cross-check candidate readings against that list — illegal notes (e.g. fret 1 on E string = F2 in G major) rule themselves out

In G major standard tuning, fret 1 can **only** appear on the B string (= C4). This kind of constraint quickly narrows ambiguous readings.

---

## Fret 1 on the B string is a reliable anchor

In open-position G major arrangements, fret 1 appears almost exclusively on the B string (= C4, the 4th scale degree). It shows up over IV chords (C major) and can serve as a visual anchor when reading a photo: any "1" you see in the upper half of the tab staff (near the B string line) is C4.

---

## `HandFret` defaults to 0 for first-position playing

`HandFret` determines where the fretboard hand-window indicator is drawn. For any arrangement played in first position (frets 0–3), set `HandFret: 0` on every note. Only raise it when the hand shifts up the neck (e.g. a passage starting at fret 5 → `HandFret: 5`). Open strings with `HandFret: 0` render the open-string marker correctly via the `drawFret = note.HandFret + 1.5` path in `FretPlayerScene3D`.

---

## Rhythmic symmetry across verses reduces encoding work

Many folk/traditional songs use the same melodic phrase for multiple verse lines (AABB or ABAB structure). "Home on the Range" has lines 1 & 3 sharing one melody and lines 2 & 4 sharing another. Encoding one line and duplicating it with adjusted `TimeOffset` values cuts the note-entry work in half and catches errors by symmetry: if a note looks wrong in line 3, compare it to the equivalent note in line 1.

---

## Pickup notes create a 1-beat offset that propagates through all subsequent bar timings

A pickup (anacrusis) shifts every subsequent downbeat by one beat relative to a naive "song starts at t=0" assumption. In 3/4 at 80 BPM:

- Pickup beat at t=0.00
- Bar 1 downbeat at t=0.75 (not t=0.00)
- Bar 2 downbeat at t=3.00
- Bar N downbeat at t = 0.75 + (N−1) × 2.25

Get this wrong and every `IsMeasure: true` beat in `arrangement.json` will be offset by one beat — the visualizer's bar lines will fall between notes instead of on them.

---

## The gap between verse lines is a rest, not silence — encode it as no notes

Between "roam" (end of line 1) and the pickup "Where" (start of line 2), there are 1.5 seconds with no notes. Do not add a filler note; simply leave the time gap empty in the `Notes` array. The highway scrolls through empty space naturally. Adding a phantom note to "fill" the gap will show a spurious fret indicator on screen.

---

## A silent `song.ogg` (or absent audio) still lets you verify the chart visually

A chart with no audio file will still render and scroll in the app (confirmed: `SongPlayer.play()` works as a pure timer when no buffer is loaded — see `lessons/engine/xr-3d-rendering.md`). For a hand-authored demo song without a recording, you can verify the note timing visually by watching notes scroll past the now-line at the expected rate before sourcing or generating audio.

---

## What a conversion pipeline would need to automate this

Manual encoding is feasible for short pieces but does not scale. A pipeline from tab/sheet music to JSON would need:

1. **MusicXML or Guitar Pro (.gp) input** — both encode fret, string, duration, and tempo in machine-readable form. MusicXML is the most widely supported export from notation software.
2. **Tempo map** — extract BPM (and any tempo changes) to convert beat positions to seconds.
3. **String/fret → HandFret inference** — heuristic: `HandFret = max(0, Fret - 1)` works for most passages; chord detection would refine it.
4. **Section markers** — extract rehearsal marks or repeat signs for the `Sections` arrays in `arrangement.json` and `lead.json`.

The hard part is not the format conversion — it is obtaining machine-readable input in the first place. Most freely available tabs are ASCII text or image scans, neither of which is easily parsed.
