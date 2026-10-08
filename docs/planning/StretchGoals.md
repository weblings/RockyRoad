# Stretch Goals

Ideas beyond the current MVP scope. No priority order — pick up when the time is right.

---

## Scoring and Progression

### End-song screen with report
Show a results screen after the song ends (or the user exits): notes hit / missed / total, hit percentage, a per-section breakdown, maybe a simple letter grade. Navigates back to the library or pre-scene to replay.

### Saving progress per section + dynamic difficulty
Track hit rate per section over multiple plays. Use this to auto-adjust which sections get looped in practice mode (loop the sections where hit rate is lowest). Store in `localStorage` keyed by song + instrument + difficulty.

### Save / load progress externally (I/O)
Export the per-song progress data as a JSON file so it can be backed up or moved between devices. Import button on the library screen or settings panel.

### Difficulty options when choosing a song
Add a difficulty selector to `PreSceneScreen` — the song format already has difficulty metadata. Filters the note chart to a simpler arrangement if the song data provides multiple difficulty tiers.

---

## Detection and Input

### Chord detection
Monophonic autocorrelation can't reliably detect two simultaneous pitches. Options:
- **Spectral peak finder** (8192-sample FFT, same approach as `NoteDetector.cs`) — detects multiple frequency peaks. Viable with a direct-in signal; noisy with a mic.
- **ML pitch detection** (CREPE via ml5.js or essentia.js) — model-based, more robust on real instruments.
- **Per-string pickup** (hardware — e.g. Rocksmith cable, Graph Tech Ghost saddles) — each string on its own channel; trivially solves the problem.
Chord scoring requires all constituent notes present simultaneously (mirrors C# behaviour).

### MIDI input for keyboard / camera setup
`navigator.requestMIDIAccess()` for keyboard instruments and drum pads. Useful for testing the tuner flow and the active scene without a guitar. Also enables a basic MIDI controller mapping for navigating the UI (start/stop, seek, etc.).

See `MidiMap.cs` for the existing drum voice mapping — that's the blueprint for the drum instrument track below.

### Piano samples via Web Audio
Load a sample pack (e.g. Salamander Grand Piano — free, ~150MB) using `AudioBuffer` per note. Triggered by MIDI input or by the score advancing past a keyboard note. `SongPlayer` continues to handle the backing track; the piano sampler is a separate `AudioContext` graph.

---

## Visuals

### Lyrics display
`SongVocals` is already parsed in `SongFormat.ts`. Render lyric lines at the bottom of the active scene: current phrase highlighted, upcoming phrase dimmed. Pure HTML overlay — no Three.js needed.

### Waveform on the scrubber
Post-load, compute a peak array from the decoded `AudioBuffer` (one peak per pixel of seek bar width). Draw as a `<canvas>` layered behind the `<input type="range">`. Gives a visual sense of song density. CPU cost is one-time at load; rendering is 2D canvas, not Three.js.

### Greying out fret track in empty sections
When the current section has no notes (e.g. an extended outro), visually dim the highway (reduce fog contrast, darken string lines) rather than showing a live-but-empty scrolling grid. The section data is already available in `instrumentNotes.Sections`.

---

## XR / Spatial

Full plan lives in [WebXR_IWSDK.md](WebXR_IWSDK.md).

**Summary:** Build the XR version as a fresh IWSDK project. `ThreeCP/v0/` preserves the polished 2D app. `ThreeCP/Project/` becomes the IWSDK-based version. Pure logic files carry over for free; rendering and UI are rebuilt around IWSDK. First prototype: get a scrolling highway rendering inside IWSDK's desktop emulation mode — this validates the QuadBatch frame ordering and FretCamera concerns before any screen migration begins.

---

## Multiplayer

### Synchronous multiplayer sessions
Multiple players join a shared session and play the same song simultaneously, each on their own instrument part. One player hosts; others connect via WebRTC (peer-to-peer, no server required beyond a lightweight signalling step).

**Session model:**
- Host picks song + starts session, shares a join code or link
- Guests pick an available instrument part (guitar, bass, keys, etc.) — parts can't be double-booked
- Host's play/pause/seek controls are authoritative; guests follow
- Each player's detection runs locally; hit/miss results are broadcast to peers and shown on a shared score overlay

**Sync approach:**
- Use the host's `AudioContext.currentTime` as the session clock. Guests receive the host's current position at join time and a timestamp; they offset their local `SongPlayer` playback to match.
- Clock drift is small over a typical song length on a stable connection; no continuous re-sync needed unless a guest falls significantly behind (detectable via periodic ping).
- If a guest's audio falls out of sync by more than ~500ms, silently re-seek and resume — same mechanism as `resumeWithCountdown` but without the countdown UI.

**Score overlay:**
- Small floating panel showing each player's name, instrument, and live hit percentage
- Coloured per instrument part — naturally distinct since parts already have string/key colour palettes

**Signalling:**
- Minimal: exchange WebRTC offer/answer + ICE candidates. Can be done via a shared `localStorage` entry on the same machine (for local testing), a free service like `PeerJS`, or a small Cloudflare Worker if a proper backend is ever added.
- No media streams needed — only small JSON data messages (clock sync, hit/miss events, transport commands)

---

## New Instruments

### Drum track
`DrumPlayerScene3D` + Web MIDI hit detection. See `ImplementationPlan.md` Stretch Goal A for the full plan. The drum voice mapping is fully documented in `MidiMap.cs`.

---

## Notes

- Items in **Scoring and Progression** are the most self-contained and highest-value for regular users.
- **Chord detection** depends heavily on input source — prioritise only if users have direct-in setups.
- **WebXR** — see [WebXR_IWSDK.md](WebXR_IWSDK.md) for the full plan. First prototype: highway rendering in IWSDK desktop emulation.
- **Piano samples** + **MIDI input** are natural partners — do them together.
- **Multiplayer** has no server requirement for the core experience — WebRTC peer-to-peer keeps it self-hostable. The signalling step is the only external dependency and can start as a copy-paste code exchange.
