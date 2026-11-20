# Keyboard MIDI input

Id: keyboard-midi-input
Status: exploratory. Researched 2026-10-30. Quest Browser test passed 2026-11-06 and immersive
test passed 2026-11-07. Native Web MIDI needed no library in either test. Tracked by RockyRoad-b74.

Research into open-source TypeScript or WASM options for detecting which key is pressed on an
88-key keyboard connected over USB. Feeds the keys-score exploration in RockyRoad-b74. The drum
scene's Web MIDI sketch in [[implementation-plan]] (Stretch Goal A) uses the same API.

## How key detection works

Same for every option below.

- Most USB keyboards are class-compliant and appear as a standard MIDI input with no driver.
- A key press is Note On: status `0x90`-`0x9F` (low nibble is the channel), note number, velocity.
- An 88-key keyboard spans notes 21 (A0) to 108 (C8), so `keyIndex = note - 21` gives 0-87.
- Many keyboards send Note On with velocity 0 instead of Note Off (`0x80`). Treat both as release.
- The sustain pedal is Control Change 64.

## Options

| Option | Where | TypeScript | Notes |
| --- | --- | --- | --- |
| Native Web MIDI (`navigator.requestMIDIAccess()`) | Browser | Built-in types | No dependency. Chrome prompts for permission (since about v124). |
| [WEBMIDI.js](https://webmidijs.org/docs/archives/v2) (`webmidi`) | Browser, Node via JZZ | Official from v3 | Friendlier events, e.g. `addListener("noteon", e => e.note.number)`. v2 and v3 APIs differ. |
| [JZZ](https://github.com/jazz-soft/JZZ) (`jzz`, MIT) | Browser and Node | TS import supported | Fills in Web MIDI where missing. Call `navigator.close()` in Node or it waits forever. |
| [@julusian/midi](https://github.com/julusian/node-midi) | Node, Electron | Ships `midi.d.ts` | RtMidi fork with prebuilt binaries. No virtual ports on Windows. Bundlers need the prebuilds copied. |
| [midir](https://github.com/Boddlnagg/midir/) (Rust) | WASM | n/a | wasm32 target wraps Web MIDI via `web-sys`. Only worth it if note handling is already Rust. |
| [web-midi](https://github.com/patchnut/web-midi) (Rust) | WASM | n/a | Thin `web-sys` wrapper, no releases. Immature. |

No WASM option reaches USB directly. In a browser everything goes through Web MIDI.

## Platform support

| Platform | Web MIDI | Confidence |
| --- | --- | --- |
| Chrome, Edge, Opera (desktop) | Yes | Confirmed by several sources |
| Firefox (desktop, 108+) | Yes | Confirmed by several sources |
| Firefox (Android) | No | One source |
| Safari | Conflicting | Low. One 2026 blog says 18+, the WebKit bug is still open |
| Meta Quest Browser | Yes, tested 2026-11-06 and 2026-11-07 | Confirmed on hardware, flat page and immersive-ar |

Existing Quest piano projects ([quest-piano](https://github.com/geniusbugra/quest-piano),
[VRtuos](https://vrtuos.eu/)) route MIDI through a PC companion. The test below shows that isn't
required for a keyboard plugged into the headset.

## Quest test, 2026-11-06

Page: `midi-test.html` + `src/midiTest.ts`, served by `npm run dev:device`. `?debug=midi` streams
events to `.debug/<session>.jsonl`. Quest 3, OculusBrowser 156 (Chrome 156), secure context.

- Web MIDI is present and prompts for permission. The keyboard (FOLDING PIANO) showed as one
  input and one output. Hot-plug `statechange` events fire.
- This keyboard sends Note On `0x90` and a real Note Off `0x80`. Others may send Note On with
  velocity 0, so treat both as release.
- A0 (note 21) gave key index 0 and C8 (note 108) gave key index 87, so `note - 21` holds.
- The first `?debug=midi` runs logged no `message` events for an unknown reason. After the keyboard
  was unplugged and the page refreshed, keys logged correctly. Not reproduced or explained.
- The later 23:51 session also logged no `message` events. Whether keys were pressed is not
  recorded. Connection events looked the same in silent and working sessions, so a connected port
  doesn't prove notes will arrive.
- Unplugging the keyboard once hard-crashed the headset. The keyboard was drawing power from the
  headset. Cause unknown, not reproduced, and outside the app's control. Setup docs should
  consider a powered hub or self-powered keyboard.
- All 11 key presses reported velocity 112, so this keyboard appears not to be touch-sensitive.
- Consecutive notes overlapped by 8-79 ms and the shortest press was about 84 ms.
- An idle keyboard sent no background messages and no pedal events appeared.

## Immersive test, 2026-11-07

`midi-test.html` gained an Enter XR button: `immersive-ar` passthrough with a green tint while a key
is down. Log: `.debug/2026-11-07T00-47-14.jsonl` (local only).

- MIDI keeps working in an immersive session: 19 Note On and 19 Note Off events, A0 to C8, no stuck
  keys. The user saw the tint react to key presses.
- Holds of about 1.1-1.2 s logged their release correctly, so Note Off can drive held-note scoring.
- `permissions.query({ name: 'midi' })` works and returned `granted`, including at page load, so a
  grant survives a page load. `prompt` and `denied` were not exercised.
- Access was requested on the flat page before the session. Calling `requestMIDIAccess()` inside a
  session was not tested, with or without an existing grant.
- The harness ran at about 90 fps, but it is a near-empty scene.

## Permission test, 2026-11-20

`midi-test.html` gained a permission panel and lifecycle logging (`access-requested`,
`access-pending` after 1.5 s, `access-granted`, `access-failed`, `permission-change`). Logs:
`.debug/2026-11-20T23-10-57.jsonl`, `23-13-00` and `23-13-23` (local only). Quest 3, OculusBrowser 157,
flat page.

| Stored state | `permissions.query` at load | Request outcome |
| --- | --- | --- |
| Granted | `granted` | Resolves in 18 ms, no prompt |
| Denied | `denied` | Rejects in 9 ms with `NotAllowedError: Permission to use Web MIDI API was not granted.` |
| Not asked | `prompt` | Pending past 1.5 s while the prompt shows, accepted after 5055 ms, state became `granted` |

- `permissions.query({ name: 'midi' })` works on Quest and reports all three states before any request.
- A stored denial rejects almost instantly, so elapsed time separates it from a dismissed prompt.
- Not seen: a dismissed prompt (neither Allow nor Block) and a `permission-change` event.

## Permission prompt inside XR, 2026-11-20

- Test page: with permission `granted` a request inside the session resolved and the session stayed
  open. With permission cleared, the request ended the session and the prompt showed on the flat page.
  Log `23-17-31`: `xr-end` came 16 ms after `access-requested`. The page never calls `session.end()`.
- Same result in the real app (IWSDK, handTracking and layers features), reproduced with a temporary
  probe that requested MIDI on the first select. So it is not a quirk of the test page.
- The mic does the same. In log `2026-11-20T23-25-27`, `xr-session-end` came 99 ms after
  `mic-request-click`. The tuner's `prompt` card labels its button "Exit VR" for this reason, and that
  button is the request trigger (`XRTunerScene._requestMic`). The older "prompt is invisible" and
  "hang unseen" wording was wrong. The browser ends the session.
- The pending request still resolved on the flat page after the user accepted, with the port list
  following. Re-entering XR is then needed.

## Design implications

- Native Web MIDI is enough. A wrapper (WEBMIDI.js v3, JZZ) would only add convenience.
- A shared module in `src/shared/` can serve desktop and XR. `decode()` in `src/midiTest.ts` is a
  starting point.
- Scoring is event matching rather than audio analysis, like the drum sketch in [[implementation-plan]].
  Note On scores a note's start, and Note Off plus the sustain pedal score how long it is held.
- Don't let velocity affect scoring or feedback, since some keyboards report a fixed value.
- Disconnects need visible UI state. A connected port alone is not proof of a working keyboard, so
  setup should confirm a real key press.
- Permission UX should follow the existing XR mic flow where it fits (RockyRoad-lha). State detection
  and the prompt behavior map directly: a `prompt` card with an honest "Exit VR" button that makes the
  request, a blocked card with a page toast after the exit, and 1 s polling since `permission-change`
  was never seen. Open: the MIDI unblock steps and whether any OS-level toggle exists.
- Entry point idea: on keys songs a keyboard icon and MIDI button replaces the Tune button on the
  pre-scene screen. Screen design comes later.

## Open questions

- Why did some sessions log no notes? Port state is now logged to help the next time it happens.
- Device connection is thin. One unplug was logged (`23-40-12`): input and output `disconnected`
  statechange events fired together and the input list went empty, then the headset crashed. Not
  tested: access granted with no keyboard, plugging one in afterwards, reconnect after unplug, and any
  hot-plug while in XR. The no-input status text exists in the test page but never ran.
- What does a dismissed prompt report, and does `permission-change` fire on Quest?
- Is there an OS-level app toggle for MIDI like the mic's Browser toggle, and what does a request do
  then (the mic request hangs)?
- What are the exact Quest browser steps to unblock MIDI? They were used to set up the denied test
  but the path wasn't recorded.
- Which surfaces need MIDI input: desktop, XR, or both?
- Not yet tested: sustain pedal, permission persistence across browser restarts, latency in the real
  app under load, multiple keyboards, reconnect in XR, other keyboards.
- Does Safari matter, given the conflicting sources?
- Guiding a user to re-grant a denied permission: RockyRoad-lha.

## Sources

- [WEBMIDI.js v2 docs](https://webmidijs.org/docs/archives/v2)
- [webmidi on Yarn](https://classic.yarnpkg.com/en/package/webmidi)
- [Chrome blog: Web MIDI permission prompt](https://developer.chrome.com/blog/web-midi-permission-prompt)
- [WebKit bug 107250](https://bugs.webkit.org/show_bug.cgi?id=107250)
- [midee 2026 Web MIDI guide](https://midee.app/blog/playing-your-midi-keyboard-in-the-browser/)
- [JZZ on GitHub](https://github.com/jazz-soft/JZZ)
- [julusian/node-midi](https://github.com/julusian/node-midi)
- [midir docs](https://docs.rs/crate/midir/)
- [patchnut/web-midi](https://github.com/patchnut/web-midi)
- [quest-piano](https://github.com/geniusbugra/quest-piano)
- [VRtuos](https://vrtuos.eu/)
