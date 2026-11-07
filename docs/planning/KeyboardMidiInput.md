# Keyboard MIDI input

Id: keyboard-midi-input
Status: exploratory. Researched 2026-10-30. Quest Browser test passed 2026-11-06. No approach
chosen, native Web MIDI needed no library in the test. Tracked by RockyRoad-b74.

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
| Meta Quest Browser | Yes, tested 2026-11-06 | Confirmed on hardware (flat page, not an XR session) |

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
- Unplugging the keyboard once hard-crashed the headset. The keyboard was drawing power from the
  headset. Cause unknown, not reproduced, and outside the app's control. Setup docs should
  consider a powered hub or self-powered keyboard.

## Design implications

- Native Web MIDI is enough. A wrapper (WEBMIDI.js v3, JZZ) would only add convenience.
- A shared module in `src/shared/` can serve desktop and XR. `decode()` in `src/midiTest.ts` is a
  starting point.
- Scoring is event matching rather than audio analysis, like the drum sketch in [[implementation-plan]].
- Disconnects need visible UI state.

## Open questions

- Does MIDI keep working inside an immersive XR session, and where does the permission prompt
  appear? The test ran on a flat page.
- Which surfaces need MIDI input: desktop, XR, or both?
- Not yet tested: sustain pedal, permission persistence across sessions, latency, multiple
  keyboards, reconnect after unplug, other keyboards.
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
