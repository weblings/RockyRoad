# Polyphon desktop validation: Mary, Fur Elise and chords

Id: 2026-11-21-polyphon-desktop-validation
Status: closed 2026-11-21 on `feat/MIDI_IO`. Mary is validated and the latency constant and gain decision are recorded. A full Fur Elise pass was skipped and chords were tested instead. Chord detection from the mic is an accepted gap, because wired MIDI is the chord path. Not yet merged to `dev` or `main`.

Closes RockyRoad-kvg.8. Follow-ups filed from this work: RockyRoad-kvg.11 (stored per-user latency calibration), RockyRoad-kvg.12 (piano key overlay and judgment row).

## Setup

- Desktop Keys play behind `?input=polyphon&debug=polyphon-frames`, Polyphon `piano` model, headphones, mic input at gain 1 unless stated.
- Runs were scored offline with `npm run replay` and a throwaway sweep script. Live and replay hit lists matched on every unmodified run.
- Logs are in `.debug/` under `2026-11-21T20-*` (Mary and Fur Elise) and `21-*` (gain and chord takes).
- Mic model and distance were not recorded.

## What landed

- `pp.gain` (default 1): applies a `GainNode` on a copy of the mic stream in `PolyphonAdapter`. The shared mic and the tuner are untouched. Recorded in the run config.
- `pp.offset`: extra latency in real seconds. Recorded in the run header so replay uses it.
- `POLYPHON_LATENCY` in `PolyphonConfig.ts` replaces the inline literal.
- Default `gateWindow` changed from 0.25 to 0.15.
- Test songs: `FurEliseChords` (the 22 chords of Fur Elise on the original track), `ChordDrill` (12 close chords every 2 s, silent) and `ChordDrillUp` (the same drill one octave higher).

## Results

### Mary Had a Little Lamb (26 notes, 1x speed)

- Gain 1, four full takes at the current latency: 85, 100, 85 and 100 percent. Pooled 94 of 104, or 90.4 percent. That clears the 90 percent bar, with little margin.
- An earlier set of four takes at 0.12 s total latency scored 81, 81, 85 and 88 percent (83.7 pooled). Replaying them with +60 ms scored 92.3 percent.
- Per-take median hit delta at the current latency: -25, -5, -96 and -43 ms. Take to take spread is about 40 ms.

### Latency

- The offset sweep on Mary peaked at about +60 ms over the original 0.12 s total. The constant now totals 0.18 s (detector 0.11).
- Hit rate is flat from about -40 to 0 ms of offset because the hit window is +-150 ms.
- Pooled medians across all Mary takes suggest a total near 0.16 s. A trim from 0.18 to 0.16 is optional and inside the noise.
- Decision: leave `POLYPHON_LATENCY` at 0.18 s total for now.

### Detector settings

- `minProb`: no effect at 0 to 0.8. Left at 0.
- Gate window: 0.15 and 0.25 give the same hits. 0.15 roughly halves extra onsets. 0.10 loses hits. Set to 0.15.
- Retrigger rise: 0 versus 0.4 differs by about 1 percent. Left at 0.2.

### Gain (Mary only)

- Gain 2: 96.2 percent (two takes). Gain 3: 94.2 percent (two takes). Gain 1: 89.7 percent at the time, 90.4 percent with the fourth take.
- The gain takes came after the gain 1 takes, so practice is a confound.
- No added latency from the gain path was visible.
- Decision: no default gain. `pp.gain` stays as an opt-in.
- Replay cannot simulate gain, so each level needs its own take. Chord results at gain 2 and 3 are in the chord section.

### Fur Elise (first 15.8 s of 53 s, 0.4x speed)

- 47 of 58 scored notes hit (81 percent). 141 notes were still pending when the run ended.
- Single notes: 42 of 46 (91 percent). Chord notes: 5 of 12 (42 percent). Extra onsets: 193 at the old gate.
- Delta median +60 ms, std 81 ms. The fast trill inflates the spread.
- A full pass has not been recorded.

### Chords (ChordDrill, 32 notes, gain 1)

| Take | `pp.on` | Hits | Lowest note of triads | Other triad notes | Extra onsets |
|---|---|---|---|---|---|
| `21-35-31` | default | 23 of 32 (72%) | 1 of 8 | 16 of 16 | 83 |
| `21-44-59` | 0.3 | 27 of 32 (84%) | 5 of 8 | 16 of 16 | 75 |
| `21-47-21` | 0.2 | 23 of 32 (72%) | 4 of 8 | 14 of 16 | 82 |
| `21-50-34` (octave up) | 0.3 | 29 of 32 (91%) | 7 of 7 played | 14 of 14 played | 63 |

- Default threshold at gain 2 (`21-54-51`): 26 of 32 (81%), lowest triad note 3 of 8, median delta -11 ms. At gain 3 (`21-56-14`): 28 of 32 (88%), lowest triad note 5 of 8, median delta -50 ms.
- Gain moves the median delta earlier (+12, -11 and -50 ms at gain 1, 2 and 3), so a default gain would need a matching latency change.
- Gain 3 and `pp.on=0.3` recovered about the same share of low notes. Gain combined with a lower threshold was not tried.
- The player made some mistakes in these takes, so small differences are not meaningful.
- A partial take (`21-43-15`) was excluded.
- In the octave-up take all three misses were one chord that the player skipped.
- In the missed low-octave cases the detector never emitted C4 or D4 at any probability. It reported their harmonics instead, such as D5 and A5 for a D4 chord.
- Octave folding in the scorer did not help, since the right pitch never appeared.
- The `pp.on` effect is not established. Takes at the same setting varied by about 5 notes.

## Findings

- Single-note Keys scoring works. Mary clears 90 percent at gain 1.
- Chords are weak in close voicings around C4 to D4 (lowest note about 40 percent). The same shape one octave up scored 100 percent of played notes.
- A2 bass notes in the Fur Elise chords hit about 5 of 6 times, so the cause is not simply low pitch. Spacing in Hz between close low partials is a hypothesis and is not confirmed.
- Wide Fur Elise chords (two octaves apart) lost the upper note, which sits on a harmonic of the bass note.

## Research

- The pitchplease README lists `piano` at 0.729 frame-level F1 on MAESTRO (`voice` 0.726, `fast` 0.679). That is the model's ceiling on clean piano, so chord misses are expected at this accuracy.
- The `piano` operating point is on 0.6 and off 0.36. The `pp.on=0.3` takes ran well below it. The README gives no chord or low-register guidance.
- Published work on neural transcription describes an entanglement problem where chords are learned as units, and older reports note weaker low-pitch performance in frequency-domain methods. No source gave results by interval width or register.
- No tuning lever remains that is likely to beat the `piano` model. `voice` and `fast` were not tried on chords.

## Decisions

- Chord detection from the mic is an accepted gap. Close low voicings are weakest. Wired MIDI is the chord path. Guitar mic chord detection has a similar weakness.
- A full Fur Elise pass was skipped. Chords were tested with the Fur Elise chord song and the two drills instead.
- Keep `pp.gain` and `pp.on` as opt-ins.

## Open

- Single C4 and D4 notes alone were not recorded, so chord masking is not separated from mic response.
- Optional loopback tone calibration was not done.
- Mic model and distance were not recorded.
- XR was not tested. No XR Keys play path exists.
