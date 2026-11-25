# Setup hub mock (RockyRoad-kqg)

Static mock of the XR Setup hub panels from `docs/planning/KeyboardMidiXRFlow.md`. Open `index.html` directly.

- Panel is 400 x 300 px for 40 x 30 cm (1 cm = 10 px). Shell and buttons come from `../panel.css`, icons from `public/`.
- Frames are anchors (`#song`, `#keys-midi-connect`, `#guitar`, `#modal-midi` and so on). `#all` shows every frame.
- Decisions strip switches apply to every frame: Retune button (tuner screen), Mic card rows, Saved calibration, Reposition on sub-states, Labels, Tuning (button or checklist row), First-run mic cards (full or trimmed), Zoom.
- Calibration is a product state, the others are design choices. No switch forces a state the product cannot reach (the Tune button and tuner screen exist only for guitar with the mic ready, guitar has no MIDI).
- The fit line under each frame is measured in the browser at 1.3 line height. It is not a uikit result, so measure the chosen layout in the dev emulator or headset.
- Static: agrees layout and content, not focus or keyboard behaviour.
- Differs from the tuner today: card and boxes use 2 cm side padding (tuner boxes use 3.5) so the one-row mic card fits.
- Guitar tuning is its own screen (option A): the mic card holds a Tune button, the tuner screen has full-size boxes, Retune and Play, and its corner button reads Setup.
- Input row and cards are centered, and the card sits centered in the space under the Input row.
