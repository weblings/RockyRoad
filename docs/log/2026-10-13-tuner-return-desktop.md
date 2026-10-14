# Tuner return: desktop enable and styling

Id: 2026-10-13-tuner-return-desktop
Status: paused 2026-10-13 — desktop tuner back on and visually iterated by the user. Auto-tune and mid-song note detection not yet checked. RockyRoad-4bi stays open.

Desktop slice of [[tuner-v2]]. XR (RockyRoad-0q4) and the string-color bug (RockyRoad-t4h) untouched.

## What landed

- `TUNER_ENABLED` set to `true` in `v2/src/desktop/App.ts` (RockyRoad-4bi.2).
- Findings 1, 2, 4, 5 applied: `.tuner-exit-btn` primary style, `.tuner-canvas-wrap` panel surface,
  `.tuner-mic-wait` text, and the `drawCanvas()` grays (RockyRoad-4bi.1).
- Tune button did not appear on the bundled songs: the manifest path dropped `tuningOffsets`. Added
  it to `tools/bake-songs.ts`, `tools/song-server.ts` and `fromManifest` in `SongSource.ts`.
- Pre-song Tune and Play side by side at XR's 15:3.6 ratio, half the column each, 6px radius.
- Gain slider restyled after Aurora's (white thumb, 8px track, JS-painted fill). Readout fixed at 36px
  and labels (Input, Gain) set to 13px semibold white so the centered row stops shifting.
- Mic level meter moved out of the canvas into the controls row: vertical 8px x 32px bar beside the Input
  select, no label. Select truncates (`max-width` + ellipsis) and Chrome's trailing `(xxxx:xxxx)` id is
  stripped from mic names. Hz readout and the "String N of 6" label removed.
- Canvas redrawn to page tokens: Inter font, 12 to 16px text, uniform 24px `PAD`, 8px fully rounded
  strings (`STRING_THICKNESS`), top/bottom margins derived so the needle never clips (`NEEDLE_REACH`).
- Needle: 4px bar in a right-hand gutter (`NEEDLE_GUTTER`) so its label never overlaps a string. Label is
  a signed number to +/-99, then `Sharp`/`Flat`. Display is median-filtered (window 7), eased (160ms) and
  clarity-gated (`NEEDLE_MIN_CLARITY` 0.8); the state machine still sees raw readings.
- Lock presentation: while the note is held the needle settles onto the string and thickens, and a 2px
  white outline fills (`strokeLockBorder`): the near edge sweeps from the right end, caps and far edge
  fade in together. Near side (above = sharp, below = flat) is fixed when the hold begins. No green, since
  string 4 is green. Dwell is 475ms correction, 235ms validation (were 250/120).
- Per-string checks in a left column: white when tuned, dim gray carried into the validation pass and
  brightened as re-verified. The "In tune!" overlay uses the same white check and white text.

## Verification (observed 2026-10-13)

- `tsc --noEmit` clean after each change, dev server run, re-baked manifest carries `tuningOffsets`.
- Tune button visible on both sample guitar songs. Controls row, canvas and lock animation iterated by the
  user in the browser with a live mic.
- Not checked: auto-tune before a stringed part, mid-song note-hit feedback, mic permission denial flow.

## Open

- Closing RockyRoad-4bi.1 needs a call on finding 3 (`.tuner-select` flat input style, low confidence, tied
  to folding the Input label into the select). Gain label cannot fold.
- `NEEDLE_MIN_CLARITY`, dwell, median window and easing are by feel. Detection dropouts do not reset the
  dwell timer.
- A faint ±10 cent target band around the active string was proposed, not built.
- Meter height (32px) is hardcoded and may sit off the select's real height.
- Remote song server needs a restart to pick up the manifest change.
- String colors: tuner now reads the fretboard palette from `v2/src/shared/StringColors.ts` (RockyRoad-t4h), not yet viewed.
- Archive [[tuner-v2]] when RockyRoad-4bi closes.

## Lessons filed

- [[lesson-engineering-hygiene]]: parallel loading path entry gained a recurrence note, new entry on
  smoothing for display versus decisions.
- [[lesson-desktop-dom]]: porting XR button sizes, custom range-input thumb, fixed-width live readouts,
  2D canvas state leaking between draws.
