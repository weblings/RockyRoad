# XR tuner: split and mic spike

Id: 2026-10-15-xr-tuner-mic-spike
Status: paused 2026-10-15. RockyRoad-0q4 is split, the mic spike (0q4.1), the shared state machine (0q4.2) and the static panel (0q4.3) are closed. Resume at RockyRoad-0q4.4 (animated pieces) and RockyRoad-0q4.5 (entry points and detector).

XR slice of [[tuner-v2]], gated on [[tuner-compact-layout]].

## Planning findings

- Desktop reaches the tuner only from the Song page: the Tune button and the auto-tune before Play (`PreSceneScreen`). The `mid-song` and `menu` contexts in `TunerScreen` are dead code. XR needs `song-flow` only.
- XR has no mic, detector or tuner code. The tuner state machine lives inside the 794-line desktop `TunerScreen`, so it has to be extracted for reuse.
- RockyRoad-0q4 split into 0q4.1 mic spike, 0q4.2 shared state machine, 0q4.3 panel (depends on both), 0q4.4 animated pieces and 0q4.5 Song entry points (both depend on 0q4.3).

## Mic spike (RockyRoad-0q4.1)

- Run on the standalone Quest Browser over LAN (`npm run dev:device`) with a throwaway probe and the existing in-headset debug console. The probe and its branches are removed.
- With the permission granted on the page first, the mic and pitch detection work inside the immersive session.
- `enumerateDevices` lists three inputs: Default, Speakerphone and Headset earpiece. The last two look like Android audio routes, not distinct mics, and their signal was not compared. The Input dropdown stays with Default preselected.
- With permission already granted for the site, entering XR starts the mic automatically. Without it, the request fires but the prompt is invisible until the user leaves immersive mode. Web research found no way to show a system toast inside a session and one matching Quest report.
- Decision: request the mic on a page step on `xr.html` before Enter XR (VR-capable device, permission `prompt`). The tuner gets a fail state (exit immersive, accept, return) with a timeout and a denied variant. Recorded in [[tuner-compact-layout]] and RockyRoad-0q4.5.
- Open: whether a pending request resolves after leaving immersive mode. Untested: a PWA launch may show a native-style dialog.
- Lessons filed in [[lesson-engine-runtime-apis]] and [[lesson-engine-dev-environment]].

## Shared state machine (RockyRoad-0q4.2)

- Moved the phase machine, needle median and easing, dwell with grace, auto-boost and `midiToNoteName`/`centsLabel` into `src/shared/TunerMachine.ts`, with no DOM or detector dependency.
- Gain changes go out through an `onGain` callback. The screen polls `phase`, `checkState(i)`, `showNeedle`, `dwellProgress` and `takeCompleteHold(ts)`.
- Desktop `TunerScreen` went from 794 to 534 lines and renders from the machine. The dead `mid-song` and `menu` contexts and `pausedAt` are removed, and `PreSceneScreen` no longer passes a context.
- Verified by `tsc --noEmit` and `vite build` only. No tests exist for the tuner and no browser run was done, so unchanged behavior rests on a line-for-line port.
- Lesson filed in [[lesson-engineering-hygiene]].


## Static panel (RockyRoad-0q4.3)

- Added `ui/tuner.uikitml`, `XRTunerScene` and a tuner panel in `index.ts` (fixed 40x30cm, Narrow arrangement). It renders a `TunerMachine` statically: current string name and color, Box 2 names, colors, checks and string lines.
- The Song page gets a Tune button for parts with `tuningOffsets`, which hides Reposition there. Reposition stays in the Play HUD, and Play will auto-tune by desktop's rule in 0q4.5. Decision recorded in [[tuner-compact-layout]].
- The gain slider is real: tap or drag with pointer capture, 1 to 24 in 0.5 steps, saved to `inputGain`. It does not drive a detector yet. The mic meter is vertical and static.
- New icon SVGs with literal fills (`tuner-check`, `tuner-restart`, `tune-icon`), copied from desktop because `currentColor` breaks the loader. Done uses the play icon like desktop's Play button but keeps its label.
- Headset review caught a missing thumb and non-interactive slider, mismatched icons, thumb overlap with the Gain labels (fixed with half-thumb margins), and missing Box 2 string lines. Box 1 and Box 2 now share the height equally.
- The string lines fade with one pre-colored PNG per string color (`tools/gen-tuner-fade.ts`), since uikit has no gradients and `Image` ignores `color`. Stepped opacity segments were tried first and rejected as too banded. A single atlas texture was judged overkill: `Image` has no UV crop, so it would need a custom material for about 2KB of saving.
- Lessons filed in [[lesson-uikit-assets-tooling-debugging]] and [[lesson-uikit-pointer-interaction]].
- `tsc --noEmit` and `vite build` clean. Compiled JSON checked for shorthand properties and unmatched classes.
- Open: Input dropdown lists only Default, Back and Done both return to the Song page and reset its Instrument and Difficulty selection.

## Animated pieces (RockyRoad-0q4.4)

- `XRTunerScene.tick` runs from `HighwaySystem.update` via `world.globals.tunerTick`. It feeds `TunerMachine` from a `PitchDetector` the scene creates itself, and `hide()` releases the mic. Permission flow and hand-off to the active scene stay in 0q4.5.
- Box 1 gets a needle bar and cents label on the lane's left percentages, the mic meter fill (height and color), and Waiting for mic and In tune overlays. The overlays are near-opaque, since uikit has no background alpha.
- Border wipe without a clip-rect: Box 1's border moved onto an overlay child, white strips along the top and bottom edges spread both ways from the bar, and a full white border appears at 100%. Strips stop short of the rounded corners.
- Writes are skipped when a value is unchanged since the last frame.
- `tsc --noEmit` and `vite build` clean. Not yet verified in the headset: strip alignment on the border, overlay look, percent `transformTranslateX` set at runtime.

## Entry points and mic permission (RockyRoad-0q4.5)

- Play auto-tunes through `autoTuneThen` in `index.ts` by desktop's rule: only when the part's `tuningOffsets` differ from the in-memory `lastTuningKey`, which is set when a tuning completes (Tune button or auto). Done continues to play even if unfinished, Back returns to the Song page.
- Deviation from the bead note: auto-tune runs before first-time calibration, not after, so the highway is not built behind the tuner panel.
- `MicPermission.offerMicPermission` shows a page bar with an Allow button on VR-capable devices when the permission state is `prompt`. It is non-blocking, so Enter XR still works.
- Safety net in the panel: if `getUserMedia` is still pending after 8s the overlay says to exit VR, allow on the page and re-enter. A late grant still starts the detector. Denial shows a site-settings message.
- No detector hand-off: XR's active scene has no pitch detection, so nothing could consume a live detector. `hide()` releases the mic on leaving the tuner, which keeps one stream at a time. Revisit when XR play gets note detection.
- `tsc --noEmit` and `vite build` clean. Headset flow Song, Tune, Play is unverified, as is whether a pending request resolves after leaving immersive mode.
