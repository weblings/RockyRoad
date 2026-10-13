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

## Verification (observed 2026-10-13)

- `tsc --noEmit` clean, dev server started, re-baked manifest carries `tuningOffsets`.
- Tune button visible on both sample guitar songs (user-confirmed in browser).
- Button sizing and radius iterated against the live page by the user.
- Slider restyle and readout width: `tsc --noEmit` clean, not yet viewed on screen.
- Not checked: the tuner screen itself, auto-tune, mid-song note detection, mic permission flow.

## Open

- Finding 3 (`.tuner-select` flat input style, low confidence): undecided. Tied to possibly folding
  the Input label into the select ("Input: Default mic"), as the active bar does. Gain label can't fold.
- Remote song server needs a restart to pick up the manifest change.
- Close 4bi.1 / 4bi.2 and archive [[tuner-v2]] once the tuner screen is confirmed on screen.

## Lessons filed

- [[lesson-engineering-hygiene]]: parallel loading path entry gained a recurrence note.
- [[lesson-desktop-dom]]: porting XR button sizes to desktop, custom range-input thumb rebuild,
  fixed-width slot for live readouts in a centered row.
