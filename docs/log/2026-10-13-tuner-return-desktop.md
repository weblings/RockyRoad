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
  white outline fills (`strokeLockBorder`): the full rounded outline is revealed by a clip-rect wipe from
  the right end (earlier dash/fade version removed, no near-side tracking). No green, since
  string 4 is green. Dwell is 475ms correction, 235ms validation (were 250/120).
- Back and Settings (RockyRoad-4bi.3, closed): top `.tuner-nav-bar`, Back left and Settings right, above the
  controls row. Back (`back()`) leaves without marking the tuning done: `song-flow` returns to the pre-song
  screen, `menu` to the library, `mid-song` resumes (no caller builds that context yet). Settings opens the
  shared panel. The tuner sets `app.activeInstrumentType` and `app.onSettingsChange` on mount (cleared on
  unmount) so the guitar section shows and invert-strings flips the needle live. Buttons sized to the Song
  page's `.pre-back` (14px text, 6px radius).
- Per-string checks in a left column: white when tuned, dim gray carried into the validation pass and
  brightened as re-verified. The "In tune!" overlay uses the same white check and white text.

## Verification (observed 2026-10-13)

- `tsc --noEmit` clean after each change, dev server run, re-baked manifest carries `tuningOffsets`.
- Tune button visible on both sample guitar songs. Controls row, canvas and lock animation iterated by the
  user in the browser with a live mic.
- Back and Settings viewed by the user in the browser (button size mismatch vs the Song page found and fixed).
  Back from each entry point and invert-strings toggling were not walked through by the agent.
- Not checked: auto-tune before a stringed part, mid-song note-hit feedback, mic permission denial flow.

- Shared buttons (RockyRoad-4bi.5, closed): `.btn` (14px, `8px 14px`, 6px radius) with `.btn-dark`,
  `.btn-light` and `.btn-lg` (15px) at the top of `v2/desktop.html`, colors from XR's primary-dark/light plus
  an active state. Migrated Back, Settings, Restart, Done, Tune, Play, settings Continue and the tuner
  complete-overlay Done. Removed `.tuner-btn`, `.tuner-btn-exit`, the `.tuner-nav-bar` override and the
  unused `.lib-btn-primary`. In-song bar and Tuner buttons grow from 12px/5px to 14px/6px.
  Left alone: `.active-play-btn` (circular) and `.lib-btn-secondary` (outline).
  Verified `tsc --noEmit` clean only, not viewed in the browser.
- Follow-ups filed: RockyRoad-6zf (port Aurora's ARIA dropdown logic), RockyRoad-vqk (shared design system
  package across projects).

- White line polish (RockyRoad-4bi.4, closed 2026-10-14): `DWELL_GRACE_MS` (150ms) via `breakDwell()` so a
  bad frame or detector dropout no longer resets the hold. `NEEDLE_GUTTER` 84 to 70 (right gap matched the
  left). `.tuner-nav-bar` made absolute so content centers on the full screen. Lock outline became a wipe.
  `tsc --noEmit` clean, not viewed in the browser by the agent.
- Not done, ideas for later: dropout hold of the display value, longer median window, `fftSize` 4096,
  McLeod first-peak picking, one-euro adaptive filter, label hysteresis, state machine on filtered cents.

## Open

- Closing RockyRoad-4bi.1 needs a call on finding 3 (`.tuner-select` flat input style, low confidence, tied
  to folding the Input label into the select). Gain label cannot fold.
- `NEEDLE_MIN_CLARITY`, dwell, median window and easing are by feel. Detection dropouts do not reset the
  display value (the dwell timer now has a grace period).
- A faint ±10 cent target band around the active string was proposed, not built.
- Meter height (32px) is hardcoded and may sit off the select's real height.
- Remote song server needs a restart to pick up the manifest change.
- String colors: tuner now reads the fretboard palette from `v2/src/shared/StringColors.ts` (RockyRoad-t4h), not yet viewed.
- Archive [[tuner-v2]] when RockyRoad-4bi closes.

## Lessons filed

- [[lesson-desktop-dom]]: XR panel.css px values are not desktop px, shared `.btn` cascade order.

- [[lesson-engineering-hygiene]]: parallel loading path entry gained a recurrence note, new entry on
  smoothing for display versus decisions.
- [[lesson-desktop-dom]]: porting XR button sizes, custom range-input thumb, fixed-width live readouts,
  2D canvas state leaking between draws.
- [[lesson-engineering-hygiene]]: shared App-owned UI needs per-screen context set and cleared.
- [[lesson-engineering-hygiene]]: hold timers on noisy values need a grace period.
- [[lesson-desktop-dom]]: clip-rect wipe for canvas outlines, absolute nav bar for centering.
- [[lesson-desktop-dom]]: draw SVG icons on canvas via `Path2D`, center asymmetric icons optically.

## Controls split (RockyRoad-4bi.6, closed 2026-10-14)

- `.tuner-controls-row` now holds only Input (with meter) and Gain, wraps so Gain drops under Input when
  narrow, divider removed. Restart and Play moved to `.tuner-actions-row` below the canvas: 312px row, two
  `btn-lg` halves at 15:3.6 like the Song page's `.pre-action-row`, plus its 8px `margin-top` (20px total
  with the 12px gap). XR `.actions` has no top padding of its own.
- Restart has the Replay icon, Done became Play with the play icon (the tuner is only entered from the Song
  page, `song-flow`; `menu` and `mid-song` contexts are still unreferenced). Overlay Done also became Play.
- Checkmarks (overlay and per-string canvas) now use the `check.svg` path, as a `Path2D` on canvas. Canvas
  check nudged up 1px for optical centering. `public/check.svg` and `public/replay.svg` committed.
- Verified `tsc --noEmit` clean, layout and checks viewed by the user in the browser.

## Compact layout planning (2026-10-14)

- Design discussion for small screens recorded in [[tuner-compact-layout]]: two same-sized boxes
  (current string with dwell-driven border wipe, string progress), row when wide and stacked when narrow.
  Setup controls on top, Restart/Done at the bottom, short-landscape tier dropped, XR later.
- Existing page has no responsive behavior: canvas fixed 960x540, controls row one non-wrapping line.
- Beads filed under RockyRoad-4bi: .6 controls split, .7 state/draw separation, .8 DOM boxes behind a
  toggle, .9 responsive switching, .10 viability check (gates RockyRoad-0q4).
- Code unchanged. Wireframes were first drawn with 4 strings from a guess, not the code (tuner is 6).

## Display state split (RockyRoad-4bi.7, closed 2026-10-14)

- New `updateDisplayState(timestamp)` in `TunerScreen.ts` owns the median/easing/clarity gate for
  `displayCents` and a new `dwellProgress` field. `tick()` calls it right before `drawCanvas()`, which now
  only reads both (and lost its `timestamp` param). Pure refactor, intended for the DOM boxes in .8.
- One benign difference: the update now runs when `offsets` is empty, where `drawCanvas()` used to return first.
- Verified `tsc --noEmit` clean. Not run in the browser.
- [[lesson-engineering-hygiene]]: derive shared display state in an update step, not inside a draw call.

## DOM box layout (RockyRoad-4bi.8, 2026-10-14)

- `?tunerBoxes` URL flag swaps the canvas for DOM Box 1 and Box 2 in `.tuner-boxes`, fixed 720x110.
  Canvas stays default. `updateBoxes()` runs instead of `drawCanvas()` and reads the same
  `displayCents`, `dwellProgress` and phase from `updateDisplayState`.
- Box 1: string-colored border with a white `clip-path` wipe from the bar's x (follows the bar during the
  hold), label left of the track and centered with it (`cqh` sized), dark track with center tick, 4px white
  bar, cents label sharing the track's lane so it clamps with `Flat`/`Sharp` justified.
- Box 2: each column is check, note name, then a string-colored line fading out before the box bottom.
  Checks follow the canvas rules. The line was added because the names alone read as too abstract.
- Order decision: Box 2 is always low string on the left, matching the low-to-high tuning order, independent
  of `invertStrings`. Web research found low to high is the standard tuning order (Fender, guitartuner.io,
  bass guides, CoachTuner, Roadie default), so a direction-by-invert tuning order was not built.
- Plan doc updated and the `invertStrings` open item removed. Verified `tsc --noEmit` clean. The user
  viewed the layout in the browser and checked it with a live mic. Bead closed.
- Lessons filed in [[lesson-desktop-dom]]: `cqh` needs a size container, label clamp via `translateX`,
  `clip-path` border wipe.

## Lessons skill counts removed (2026-10-14)

- The "N entries" wording in the desktop-dom, engineering-hygiene and song-content-authoring SKILL.md files
  is gone. It had drifted ("five" vs 13) because only the README table count is checked. Filed under
  [[lesson-engineering-hygiene]].

## Responsive layout switching (RockyRoad-4bi.9, 2026-10-14)

- `?tunerBoxes` is gone. Canvas and boxes are both mounted, and a `ResizeObserver` on `.tuner-body` sets
  `data-layout` (large, medium, narrow) on `.tuner-main` via `applyLayout()`. `tick()` runs `drawCanvas()` in
  Large and `updateBoxes()` otherwise. CSS shows one renderer.
- Breakpoints: Large under 960x760 inner size switches to Medium immediately (no canvas scale floor), Medium
  to Narrow under 560px wide. Recorded in [[tuner-compact-layout]].
- Overlays stay on `.tuner-canvas-wrap`, so they cover whichever layout shows. The overlay check shrinks to
  36px in compact layouts.
- Narrow: boxes stacked, `container-type: size` moved to Box 1 only, since it would collapse Box 2's height.
- Nav overlap fix: in Medium and Narrow the nav bar is in flow as its own row (`:has()` on the screen) and the
  body scrolls with `margin: auto` centering. The Song page does the same under `max-height: 700px`, with
  Back in flow and the content's top padding reduced. Resolves the nav overlap open item.
- Side effect: with the nav in flow the body is about 66px shorter, so returning to Large needs that much
  more height than leaving it. This gives hysteresis, not flicker.
- Verified `tsc --noEmit` clean. The user viewed the result in the browser.
- Lessons filed in [[lesson-desktop-dom]].
