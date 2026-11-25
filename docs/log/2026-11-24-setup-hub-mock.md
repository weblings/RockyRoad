# Setup hub mock: layout, owner decisions and flow doc rewrite

Id: 2026-11-24-setup-hub-mock
Status: mock built and reviewed 2026-11-24 on `feat/MIDI_IO`, bead RockyRoad-kqg left open for the owner to close. Not yet merged to `dev` or `main`.

Static mock of the XR Setup hub panels from [[keyboard-midi-xr-flow]]. Open `ui/Export/XR/SetupHub/index.html` from the folder. Frames are anchors (`#guitar`, `#mic-req`, `#modal-midi`) and `#all` shows every frame. A strip of switches applies to every frame. Aurora's Grille mock was the method reference.

## Owner decisions

- Requirements card: one line per bullet, not the (i) icon, since a modal over a modal means backtracking twice.
- Guitar tuning is a Tune button in the mic card, not a checklist row. Retune is labelled. Reposition shows on every sub-state. Labels are Input and Mic.
- Mic is one XR flow for Keys and guitar. The Quest mic clipped non-voice audio in the guitar tests, so Keys is expected to need an external mic too. Not verified on piano.
- Tuner is a large modal over Setup with Retune and Done. Song stays the corner button, Play stays on Setup, and the Bluetooth reminder is a modal on Setup's Play.
- The not-ready modal shows only on Setup's Play. The Song page Play plays unscored in XR and desktop may route through the tuner, open. Skip keeps the saved Input and the repeat is intended.
- Requirements and headset cards have no Continue or Dismiss. Quest steps sit behind an (i) modal. None card reads "Scoring is disabled". MIDI blocked copy matches the mic's wording.
- Step markers are circles (ring and circled check), requirements bullets stay dots. Mock markers are placeholders for the Zest circled-check and an owner ring variant.

## What the mock found

- Stacking Input row, mic card and tuner boxes overflowed the guitar screen by 7.3 cm. Header placement and compact boxes fit but were cramped, and splitting the tuner out fixed it.
- A Bluetooth line on the mic card overflowed by 2.2 cm, so the reminder became a modal.
- The first-run mic cards as the tuner has them overflowed (requirements 4.5 cm, headset warning 4.1 cm). Cutting Continue and Dismiss, tightening copy and moving the Quest steps behind an (i) brought them in. Part of the overflow was mock padding (14 px under the centred card, now 6 px).
- Fit numbers are a browser estimate at 1.3 line height. The tightest screen is the one-line requirements card at 0.4 cm spare. The line also fits its width only just, and uikit does not wrap.

## Verification

- Headless Chromium over every frame: zero console errors, screenshots inspected after the last visual change.
- The mock's measured fit table is in [[keyboard-midi-xr-flow]] under "Fit estimate".

## Open

- Measure the built screens in the dev emulator or headset.
- Verify the Quest mic on piano and settle "External mic" versus "USB mic" for Keys.
- Desktop Song page Play with an unready input.
- Dark variant of the plain check for the tuner modal's Done button, and the final circled-check and ring assets.
- `public/` icon SVGs show as modified in git and were not edited in this work. Check before committing.
