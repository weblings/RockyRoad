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

## Headset feedback on 0q4.4 and 0q4.5

- Animations looked right. The Quest mic was too quiet even at 24x, so 48x was tried first. It got through all six strings but still needed the guitar at the headset.
- Gain does not improve accuracy: the detector is a normalized autocorrelation, so gain only lets weak frames past the `rms < 0.005` silence cutoff while amplifying noise equally. XR is back to 1x to 24x, and `PitchDetector.create` takes a `minRms` that XR sets to 0.001. The clarity gates still guard accuracy.
- The Input dropdown lists `enumerateDevices` audio inputs once the mic is granted, and picking one restarts the detector on that device. `shortMicLabel` moved to `shared/MicLabel.ts`.
- XR border wipe now spreads from the bar's center target (50%) instead of the needle's x, so it always starts at the tuning target. Desktop's box layouts still start at the needle.
- Unverified: whether 0.001 is low enough, and whether Speakerphone and Headset earpiece are real separate mics.
- The In tune and Waiting for mic overlays are now fully opaque and hide Box 1 and Box 2 underneath. The 0.94 opacity let the six Box 2 check images z-fight through the scrim.
- Confirmed in headset: the clipping fix, the Input dropdown, all six strings tuning, and the animations.

## Mic investigation and weak-mic warning (2026-10-16, RockyRoad-0q4.6)

- Built a dev debug channel (`/__debug` Vite plugin, `shared/DebugLog.ts`) so the headset sends per-frame detector logs and raw mic audio to `v2/.debug/`. Recordings replay offline against detector variants.
- Quest built-in mic is gated to digital silence (51 to 69% exact-zero blocks, pitch on 21% of frames), and low-string fundamentals are missing. AirPods as "Headset earpiece" were no better. Browser constraints are reported off, so the processing is below the browser.
- A USB mic (ATR2100x-USB, a foot from the guitar) worked: no gating, pitch on 72% of frames, all six strings tuned. Quest lists it only after Settings > Experimental > External Microphone is on and the headset restarts.
- Detector: `minHz` floor with a matching high-pass (rumble 767 frames to 0, low E hits 95 to 258), and the McLeod key-maximum rule (octave-off frames 234 to 58). Details in [[lesson-engine-runtime-apis]].
- Tuner now auto-selects a non-built-in input unless the user picked one, sizes the Input menu to its options, and shows an opaque weak-mic overlay with a Dismiss button on entry when the input list holds only built-in routes. Quest gets the Settings path, other headsets get general wording.
- Web research found no documented USB mic support on Pico, Galaxy XR, Vive Focus Vision or Vision Pro, so guidance stays Quest only.
- Not verified in headset: the overlay layout and text fit, USB auto-select, and the sized menu. Desktop tuner picks up the key-maximum rule and is untested.
- Open: the live detector hand-off to the active scene is still absent, and the Rocksmith cable has not been tried.
- The 15 s timer version of the warning never showed, because every logged tuner visit was under 15 s. It now shows on entry when the input list is built-in only ([[lesson-engineering-hygiene]]).
- Warning is a card centered on the opaque scrim, like the In tune overlay. The first version shrink-wrapped its Quest text block, so a line wrapped and overlapped, and the stack ran into the actions bar. Fixed with a fixed-width card, shorter lines, a width of 100% on the text group, a Dismiss top margin and a small `position-top` nudge. Headset screenshot confirmed it reads well enough ([[lesson-uikit-syntax-and-styling]]).
- Scoring detector output against the tuner's current string overcounted errors. Most "other" frames were the previous string ringing.
- Follow-up beads: RockyRoad-0q4.7 (Rocksmith cable), RockyRoad-0q4.9 (permission fail states as a card), and a flicker-on-enter bug under RockyRoad-0q4.
- Lessons filed: engine `runtime-apis.md` (mic gating, key-maximum rule, rumble floor), `dev-environment.md` (debug channel), ui-toolkit `scrolling-and-dropdowns.md` (menu sizing) and `syntax-and-styling.md` (card width), and `engineering-hygiene.md` (entry-time warnings, scoring proxies).
- Tooling note: `bd update --notes` replaces the whole field. Use `--append-notes`. This overwrote RockyRoad-0q4.5's notes once, restored from the earlier `bd show`.
