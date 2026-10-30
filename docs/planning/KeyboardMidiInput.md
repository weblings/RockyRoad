# Keyboard MIDI input

Id: keyboard-midi-input
Status: exploratory, researched 2026-10-30. No library or approach chosen. Tracked by RockyRoad-b74.

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
| Meta Quest Browser | Unknown | Nothing found |

No source says a USB keyboard plugged into a Quest headset works through Web MIDI. Existing Quest
piano projects ([quest-piano](https://github.com/geniusbugra/quest-piano),
[VRtuos](https://vrtuos.eu/)) route MIDI through a PC companion.

## Open questions

- Does Quest Browser expose a USB keyboard plugged into the headset? Needs a hardware test with a
  minimal Web MIDI page.
- Which surfaces need MIDI input: desktop, XR, or both? This decides whether the Quest test blocks.
- If Quest doesn't expose it, is a PC bridge acceptable (e.g. `@julusian/midi` relayed over WebSocket)?
- Native Web MIDI or a wrapper (WEBMIDI.js v3, JZZ)?
- Does Safari matter, given the conflicting sources?

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
