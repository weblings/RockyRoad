# Mic note detection spike: Polyphon vs Poly Peach (paused)

Id: 2026-11-21-mic-note-detection-spike
Status: paused 2026-11-21 on `feat/MIDI_IO`. Both libraries were run on Quest Browser. No recommendation doc yet. Polyphon was later built into desktop Keys scoring (see the follow-up below).

Bead: RockyRoad-8w1 (open). Resume by adding an expected-notes filter and `on`/`off` URL parameters to the Polyphon test page, then testing `fast` and a known chart.

Follow-up 2026-11-21: Polyphon was built into desktop Keys scoring behind `?input=polyphon` (epic RockyRoad-kvg). The expected-notes filter is now the onset gate, and `on`/`off` are the `pp.on` and `pp.off` URL parameters. Design is in [[keyboard-midi-xr-flow]] and desktop results are in [[2026-11-21-polyphon-desktop-validation]]. Poly Peach is still unscored and can be replayed on recorded frames (RockyRoad-jvm).

## What landed

- `polyphon-test.html` and `src/polyphonTest.ts`: mic page for `@markusstrasser/pitchplease` 3.1.0. Model buttons (`fast`, `piano`, `voice`, `fft`), live notes with per-note `prob`, and `kernel`, `cpuLoad`, fps and detector latency every 2 s. `?debug=polyphon` streams `start`, `notes`, `stats` and `set-model` to `.debug/`.
- `poly-peach-test.html` and `src/polyPeachTest.ts`: mic page driving poly-peach's `Chromagram` class directly. A note counts when its level is at least `?rel=` (0.5) of the loudest and above `?floor=` (0.15). `?interval=` sets samples between updates. `?debug=polypeach` logs `notes` with per-note `levels`.
- `DebugLog.ts`: `polyphon` and `polypeach` features.
- `vite.config.ts`: both packages added to `optimizeDeps.include`.
- `package.json`: devDependencies `@markusstrasser/pitchplease` 3.1.0, `poly-peach` 0.5.1 and `fft.js` 4.0.4.

## Verification (Quest Browser, 48 kHz, logs in `.debug/2026-11-21T01-44-22`, `01-47-53` and `01-49-33`)

- Polyphon `piano`: `kernel` `wasm-relaxed`, `cpuLoad` 0.68 to 0.72 (README claims 0.20 on Chrome with an M3 Pro), about 86 fps, detector latency 27 to 37 ms, start 96 ms to 2.4 s.
- Polyphon note changes (first run, 215 spans): median 9 ms, 151 at 20 ms or less, 7 at 100 ms or more, none at 300 ms or more.
- Polyphon with `prob` (191 spans): median 7 ms, 146 at 20 ms or less.
  - Sustained played notes reached 0.9 to 1.0 (`F5`, `C5`, `B4`, `A4`, `G5`) and fell to 0.4 to 0.7 in decay.
  - Phantoms below C3 (mostly `A#1` to `E2`) were 204 readings with mean `prob` 0.70, 19 at 0.9 or more. C3 and up had 173 readings, mean 0.79, 71 at 0.9 or more.
- Poly Peach (165 spans, first run): median 64 ms, 61 at 100 ms or more, 19 at 300 ms or more. Main-thread load 0.02.
  - Sustained `F5` read 0.52 to 0.42. A chord read `A4:0.39 C5:0.77 F5:0.60` plus ghosts `C6:0.43 A6:0.44`.
  - Real notes at 51 to 100% of the loudest and ghosts at 56 to 57%, so no relative threshold separates them.
  - As a played note decayed to about 0.37, noise at 0.17 to 0.27 passed the relative test and the list grew to 10 notes (`C#3` to `F#3` plus the played notes).
- Mic permission was already granted on the origin, so no prompt behavior was tested. Polyphon has not been run with `fast`, `voice` or `fft`. No XR session was tested.

## Findings

- Polyphon is the better base. Its flicker is single-frame blips, and played notes reach 0.9 or more when sustained.
- Raising Polyphon's `on` threshold to about 0.85 would drop most phantoms but would delay onsets that start at 0.6 to 0.8, and some phantoms still pass at 0.9 or more. Targeting expected notes only (as wait mode knows the chart) is the stronger fix.
- Poly Peach 0.5.1 is not a library. It has no WASM (the bead said it did), uses `fft.js` and a deprecated ScriptProcessor, and `PolyPeachDetector` needs `#alert-histogram` DOM and `tone`. Only `Chromagram` is reusable.
- Poly Peach covers only C3 to B6 and analyzes a 8192-sample buffer at a quarter of the sample rate (about 0.7 s), which smears fast passages. It is LGPL and 23 MB unpacked.
- Poly Peach levels depend on input scale. Float audio gives 0.09 (room) to 0.7 (played), so the library demo's floor of about 2 detects nothing.
- Both libraries show ghost notes, so neither is usable on raw output.

## Dead ends and process notes

- The Poly Peach page was dead on first load. `fft.js` is only in poly-peach's devDependencies, so it was never installed and Vite's bundle request returned 504. The dev script was never attached, so no error showed. Fixed by installing `fft.js` directly.
- Adding `optimizeDeps.include` before installing `fft.js` crashed the dev server at startup. The server was restarted with `npx vite --mode device --open false` (no song server).
- The Windows user agents seen in the logs came from page-load lines of other pages in the same session file. They were wrongly read as proof the Polyphon run was desktop. The runs were on Quest.
- A debounce for Polyphon flicker was proposed and rejected. It would lag fast passages.
- The first Poly Peach floor (2) assumed the demo's scale and was wrong for float audio.

## Open

- No expected-notes filter has been tried on either library, and `fast` has not been run.
- Accuracy is unscored because no played-note ground truth was logged.
- Whether `cpuLoad` 0.7 on Quest leaves room beside XR rendering is untested.
- LGPL acceptability for Poly Peach is undecided.
- `.codex/config.toml`, `public/songs/manifest.json`, `.iwsdk/` and `RockyRoad_v0.3.1.zip` were left out of the commit.
