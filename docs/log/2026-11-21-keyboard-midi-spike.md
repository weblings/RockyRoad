# Keyboard MIDI spike and XR flow design

Id: 2026-11-21-keyboard-midi-spike
Status: closed 2026-11-21 on `feat/MIDI_IO`. Feasibility is done and the XR flow is designed. Nothing is built in the app. Not yet merged to `dev` or `main`.

Closes RockyRoad-b74. Follow-ups: RockyRoad-lha (permission recovery), RockyRoad-dgu (integration and load testing). RockyRoad-dv9 (wait mode) is no longer blocked by b74 but still needs a keys-scoring bead that doesn't exist yet.

## What landed

- `midi-test.html` and `src/midiTest.ts`: Web MIDI test page with an Enter XR button (immersive-ar, green tint while a key is down), a permission panel (query state, request phase), request timing, a 2 s permission poll, window focus and blur logging, and a `chrome://` link test row. An XR select requests access, to test a first request inside a session.
- `docs/planning/KeyboardMidiInput.md`: test results by date and the design implications.
- `docs/planning/KeyboardMidiXRFlow.md` (new): requirements page, permission cards and keyboard checklist for XR, with the state flow and fit estimates.
- Lessons in `docs/lessons/engine/runtime-apis.md`: permission requests end the XR session (replaces the old "invisible prompt" entry), Web MIDI permission states and timing, `connected` statechange on handler attach, and the MIDI addition to the no-route-to-Settings entry.
- Two stale comments in `XRTunerScene.ts` corrected. No behavior change.
- A temporary probe in `src/xr/index.ts` requested MIDI on the first select in the real app. It was removed before the commit.

## Verification (observed on Quest 3, OculusBrowser 156 and 157)

- 2026-11-06 and 2026-11-07: Web MIDI present and prompting. Note On and Note Off arrived on the flat page and in immersive-ar, A0 to C8, holds of about 1.2 s released correctly, `note - 21` gave key index 0 to 87.
- 2026-11-20 permission states: `prompt`, `denied` and `granted` were all read by `permissions.query`. Denied failed in 9 ms with `NotAllowedError`, granted resolved in 18 ms, and prompt stayed pending until answered (5055 ms in the log).
- 2026-11-20 prompt inside XR: the session ended 16 ms after the request in the test page and in the real app (IWSDK, `handTracking` and `layers` features). The pending request resolved on the flat page after the user accepted. With the state `granted`, the same request resolved in 2 ms and the session stayed open.
- 2026-11-20 mic comparison: the existing tuner log `2026-11-20T23-25-27` showed `xr-session-end` 99 ms after `mic-request-click`. So the mic does the same, and the "Exit VR" label on its permission card is accurate.
- 2026-11-20 devices: access granted with no keyboard gave `inputs: []`. Plug-in, unplug and replug were picked up through `statechange` with notes resuming. Plugging in with permission not granted raised no system prompt, no exit and no page events (confirmed by the user on headset).
- 2026-11-21 XR hot-plug (`2026-11-21T00-02-22`): unplug and replug inside a session worked, notes resumed, the session stayed open and the heartbeat `inputs` count went 1, 0, 1.
- 2026-11-20 chrome link test: plain, `target=_blank`, `chrome://settings/content/midiDevices` and `window.open` all did nothing (`window.open` returned `null`).
- Typecheck and `check-links.py` were clean. `check-lessons.sh` was clean after the new entries.

## Findings

- The mic notes said a first-time prompt in XR was invisible or hung unseen. The logs show the browser ends the session to show it. The mic's card and button wording already followed the behavior. Only the explanation was wrong.
- The MIDI unblock path is not in the Horizon OS browser menus. It is `chrome://settings` in a new tab > Site Settings > All Sites > the site > "MIDI device control & reprogram". That page renders over the tabs and the top-left back button is the only way out.
- A `statechange` `connected` event also fires when the handler is attached, so it can't be read as a plug-in on its own. A repeat request while granted re-fires it.
- Screen fit: the Song page action bar holds two 15 cm buttons at most, so a MIDI button for Keys competes with Reposition. Where Reposition goes is open.
- The fit estimates (about 16 cm for the requirements page, 15.5 cm for the worst card, 11 to 12 cm for the checklist against about 20.8 cm available) assume a 1.3 line height and are not measured.
- Design decisions: the requirements page shows once per page session. Permission uses the mic's card pattern with Exit VR. The corner button always reads Song and leaves, with no step back, as in the mic flow. The keyboard steps are a short checklist ending in a done state and Play.
- Dead end: a three-row checklist that folded permission into the same page was dropped in favor of cards that are already proven in a headset.
- Process: the first answer about whether the mic's automatic exit had been observed missed an existing log. The relevant log was only found after searching all of `.debug`, not only the MIDI logs.

## Open

- The first hard crash on unplug (2026-11-06, keyboard drawing power from the headset) has not recurred. If it does, the requirements page is where to advise a powered hub or self-powered keyboard.
- Some early `?debug=midi` sessions logged no `message` events. Cause unknown, and not reproduced since.
- Sustain pedal, a second keyboard, held notes on unplug, latency under load and a real-app note path are untested (RockyRoad-dgu).
- A dismissed permission prompt was never seen, so what it reports is unknown.
- Whether an OS-level toggle for MIDI exists.
- Pause and resume in XR has no bead, and the disconnect behavior depends on it.
- Implementation beads for the flow are not filed.
- `.codex/config.toml` and `public/songs/manifest.json` show as modified and were left out. `.iwsdk/` and `RockyRoad_v0.3.1.zip` are untracked.
