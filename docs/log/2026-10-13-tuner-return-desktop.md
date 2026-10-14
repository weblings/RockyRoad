# Tuner return: desktop enable and styling

Id: 2026-10-13-tuner-return-desktop
Status: paused 2026-10-13 — desktop Tune button back on, tuner screen itself not yet checked on screen. RockyRoad-4bi stays open.

Desktop slice of [[tuner-v2]]. XR (RockyRoad-0q4) and the string-color bug (RockyRoad-t4h) untouched.

## What landed

- `TUNER_ENABLED` set to `true` in `v2/src/desktop/App.ts` (RockyRoad-4bi.2).
- Findings 1, 2, 4, 5 applied: `.tuner-exit-btn` primary style, `.tuner-canvas-wrap` panel surface,
  `.tuner-mic-wait` text, and the `drawCanvas()` grays (RockyRoad-4bi.1).
- Tune button did not appear on the bundled songs: the manifest path dropped `tuningOffsets`. Added
  it to `tools/bake-songs.ts`, `tools/song-server.ts` and `fromManifest` in `SongSource.ts`.
- Pre-song Tune and Play now sit side by side at XR's 15:3.6 ratio, half the column each, 6px radius.
- Gain slider restyled after Aurora's slider (white thumb, 8px track, JS-painted fill); readout given a
  fixed 36px width so the centered controls row stops shifting while dragging.
- Controls-row labels (Input, Gain) bumped to 13px semibold white. User: "a bit better", not final.
- Canvas pass beyond finding 5's grays: Inter font, smaller text (12 to 16px), thinner lines (string 1/2px,
  needle 2px), 8px signal bar, and a uniform 24px outer padding (`PAD` in `drawCanvas()`). User: "progress
  for now", still iterating.
- Mic level meter moved out of the canvas into the controls row: vertical 8px x 32px bar beside the Input
  select, no label. Collapsed select truncates (`max-width` + ellipsis) and Chrome's trailing `(xxxx:xxxx)`
  id is stripped from mic names. Hz readout removed. Strings and needle redrawn as 8px fully rounded
  rects (`STRING_THICKNESS`) to match the meter.
- Needle: eased toward the detected pitch for drawing only (`NEEDLE_SMOOTHING_MS`, raw value still drives the
  state machine), 4px thick vs 8px strings, label horizontal to its right. Label is a signed number to
  +/-99, then `Sharp`/`Flat` (octave correction made raw cents reach the hundreds). Cent sign dropped.
- Canvas margins now derived so the needle can swing past the outer strings without clipping
  (`NEEDLE_REACH`); "String N of 6" label removed from the row.
- Lock presentation: filling ring and green flash removed. While held in tune the white needle lengthens
  to the full string and thickens to 8px (no color change, since string 4 is green). Per-string checks in
  a left column: white when tuned, dim gray carried into the validation pass and brightened as re-verified.
- Needle jitter: 5-sample median filter plus 140ms easing before drawing (`NEEDLE_MEDIAN_WINDOW`,
  `NEEDLE_SMOOTHING_MS`). Dwell times set to 475ms correction, 235ms validation (were 250/120).

## Verification (observed 2026-10-13)

- `tsc --noEmit` clean, dev server started, re-baked manifest carries `tuningOffsets`.
- Tune button visible on both sample guitar songs (user-confirmed in browser).
- Button sizing and radius iterated against the live page by the user.
- Slider restyle, readout width and canvas pass: `tsc --noEmit` clean, viewed by the user and iterated.
- Not checked: the tuner screen itself, auto-tune, mid-song note detection, mic permission flow.

## Open

- Dwell, median window and easing values are by feel; no live-mic verification yet. Detection dropouts do not reset the dwell timer.
- Faint target band around the active string was proposed, not built.
- Meter height (32px) is hardcoded, may sit off the select's real height. Needle covers string color when centered.
- Canvas text sizes, line weights and string/signal colors may need further tuning; colors tie to RockyRoad-t4h.
- Finding 3 (`.tuner-select` flat input style, low confidence): undecided. Tied to possibly folding
  the Input label into the select ("Input: Default mic"), as the active bar does. Gain label can't fold.
- Remote song server needs a restart to pick up the manifest change.
- Close 4bi.1 / 4bi.2 and archive [[tuner-v2]] once the tuner screen is confirmed on screen.

## Lessons filed

- [[lesson-engineering-hygiene]]: parallel loading path entry gained a recurrence note.
- [[lesson-desktop-dom]]: porting XR button sizes to desktop, custom range-input thumb rebuild,
  fixed-width slot for live readouts in a centered row.
