# Keyboard MIDI input

Id: keyboard-midi-input
Status: feasibility done 2026-11-21 (RockyRoad-b74, closed). Researched 2026-10-30. Quest tests
passed for notes, permission states, the permission prompt in XR and hot-plug, in a flat page and in
immersive-ar. Desktop tests ran 2026-11-21 on Chrome and Firefox. Native Web MIDI needed no library.
Flow design is in [[keyboard-midi-xr-flow]]. Integration and load testing is RockyRoad-dgu. The shared
permission helper and the desktop path are RockyRoad-7wy.

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

## Device connection test, 2026-11-20

Flat page, permission `prompt` at load. Log `2026-11-20T23-38-31`. The 2026-11-06 unplug in `23-40-12`
was the only earlier hot-plug evidence.

- Access granted with no keyboard attached is a distinct state: the first listing was `inputs: []`.
- Plugging the keyboard in afterwards fired `statechange` `connected` for the input, then the output.
  The input port opened itself within 2 ms once the page attached its handler. No reload or
  re-request was needed.
- Notes arrived after the plug-in (Note On and Note Off).
- Unplug fired `disconnected` for input and output together and the list went empty. Replug repeated
  the plug-in sequence and notes arrived again. No headset crash this time.
- Plugging a keyboard in while permission was not granted produced no system prompt, no automatic
  exit (confirmed on headset, flat page and XR). The page can't see devices before access is granted,
  so the logs have no events in that state.
- A request with permission already `granted` resolved in 2 ms inside an XR session and the session
  stayed open, so re-requesting on entry is safe.
- Hot-plug works inside XR too (log `2026-11-21T00-02-22`, access granted before entering). Notes
  arrived in the session, unplug fired `disconnected` for input and output and the input count went to
  0, and replug 5.4 s later fired the connect sequence with notes arriving again. The session stayed
  open throughout and no re-request was needed. The XR heartbeat's `inputs` count tracked it (1, 0, 1).

## Desktop test, 2026-11-21

`midi-test.html` on `npm run dev` at `https://localhost:8081`, Windows, same keyboard (FOLDING PIANO).
Logs: `2026-11-21T00-32-45` and `00-33-54` (Firefox 160), `00-36-03` to `00-37-11` (Chrome 158).

| Check | Chrome 158 | Firefox 160 |
| --- | --- | --- |
| `permissions.query({ name: 'midi' })` | `prompt`, `granted`, `denied` | `prompt`, `granted` |
| Prompt | Inline, resolved in 2.3 to 2.9 s, nothing ends | Inline, resolved in 2.3 s |
| Request while `granted` | 42 ms | 0 ms |
| Request while `denied` | `NotAllowedError` in 1 ms | Not tested |
| Unplug and replug | `disconnected` then `connected` for input and output, notes resume | No `statechange` of any kind, user saw no redetect or notes |
| Revoke through the address bar lock icon | `granted` to `prompt` to `denied` in about 2 s, seen only by the poll | Not tested |
| `permission-change` event | Not seen | Seen once, 1 ms before `access-granted` |
| Note Off | Real `0x80` | Real `0x80` |

- The Firefox logs end on note events with no `disconnected`, so the page was never told about the
  unplug. An unplug after the last flush can't be ruled out from the logs alone.
- Not tested on desktop: a dismissed prompt, the Firefox denial and revoke paths, whether polling
  `access.inputs` would rescue Firefox hot-plug, Safari, a second keyboard, the sustain pedal.
- Firefox's settings showed no MIDI or per-site permission entry, so no Firefox recovery path is known.
  The Quest `chrome://settings` path doesn't apply on desktop. Chrome's recovery is the lock icon.
- The XR emulator did not enable the Enter XR button on Chrome desktop (`xr-supported` false).

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
- Unblocking MIDI is awkward and differs from the mic. It isn't in the Horizon OS browser settings. It
  piggybacks on Chromium: open a new tab, go to `chrome://settings`, then Site Settings > All Sites,
  find the site, and set "MIDI device control & reprogram". That Chrome page renders on top of the
  Horizon OS browser tabs, so the only way back is the back button at the top left. A page can't
  open it. Plain, `target=_blank` and deep (`chrome://settings/content/midiDevices`) links did
  nothing and `window.open` returned `null` (log `2026-11-20T23-59-53`). The toast gives the steps as
  text.
- Desktop is lighter than XR. The prompt is inline and nothing ends, so the permission cards aren't
  needed, only a short denied and an unsupported message. Chrome or Edge is the tested browser, since
  Firefox didn't redetect a replugged keyboard. README and Setup say so. The permission state read and
  the 1 s poll are shared between desktop and XR (RockyRoad-7wy). The XR mic moving onto it is
  RockyRoad-3i2 and a clearer desktop mic failure message is RockyRoad-63n.
- Entry point idea: on keys songs a keyboard icon and MIDI button replaces the Tune button on the
  pre-scene screen. Screen design comes later.

## Open questions

- Why did some sessions log no notes? Port state is now logged to help the next time it happens.
- Not tested: a second keyboard and whether held notes clear on unplug.
- What does a dismissed prompt report, and does `permission-change` fire on Quest?
- Is there an OS-level app toggle for MIDI like the mic's Browser toggle, and what does a request do
  then (the mic request hangs)?
- Which surfaces need MIDI input: desktop, XR, or both? Desktop works on Chrome, so the cost is
  the screens, not feasibility.
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
