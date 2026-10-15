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
- Headset review caught a missing thumb and non-interactive slider, mismatched icons, and thumb overlap with the Gain labels (fixed with half-thumb margins). The Box 2 string lines were added after that review and are not yet seen in the headset. Box 1 is a fixed 6.5cm to make room, and the lines do not fade like desktop's.
- `tsc --noEmit` and `vite build` clean. Compiled JSON checked for shorthand properties and unmatched classes.
- Open: Input dropdown lists only Default, Back and Done both return to the Song page and reset its Instrument and Difficulty selection.
