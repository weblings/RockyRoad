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

### WebXR — full plan

#### Session strategy

On app load, run two checks in parallel:

1. `navigator.xr?.isSessionSupported('immersive-vr')` — is XR available at all?
2. Is this a **standalone XR device**? Heuristic: XR is supported AND `!window.matchMedia('(pointer: fine)').matches` (no mouse) AND the UA contains a known standalone identifier (`OculusBrowser`, `Quest`, `VRBrowser`). PC users with a tethered headset have a fine pointer and a normal browser window — they get a **"Enter VR"** button instead of auto-entry.

**Standalone device:** show a minimal fullscreen landing page — one large "Tap to start" button. The browser requirement that `requestSession` must be called inside a user gesture means a single tap is unavoidable, but the experience feels immediate. On tap, `xr.requestSession('immersive-vr')` fires and the app enters XR. The user never sees the 2D app.

**PC + headset:** standard browser window loads normally with an "Enter VR" button in the app UI. Clicking it starts the session.

**No XR:** 2D mode, no changes from today.

`renderer.setAnimationLoop` replaces the current `requestAnimationFrame` call in `App.loop()` — it works identically in 2D but is required for XR. This is the only change to the render loop. `renderer.xr.enabled = true` is set once in the constructor.

---

#### World anchor

A single **world anchor** `THREE.Group` sits in the XR scene. Everything the app renders lives as a child of this group. Moving or rotating the anchor repositions the whole experience in physical space. On session start, the anchor is placed **1 m in front of the user** at eye height, facing them — derived from the initial XR camera pose via `renderer.xr.getCamera().position` and its forward direction.

**Recenter** resets the anchor to that default position/orientation relative to the current head pose. Bound to the left controller menu button and a button on the UI panel.

---

#### Two panels

**Panel A — 3D highway panel**
The `FretPlayerScene3D` renders into a `WebGLRenderTarget`. A `PlaneGeometry` mesh (child of the world anchor) displays that texture — the highway appears as a large floating screen. Default size ~3 m × 1.5 m. This panel is directly and always tied to the world anchor; the gizmo manipulates the anchor, which moves this panel with it.

**Panel B — 2D UI panel**
The HTML screens (library, pre-scene, tuner) need to be visible in XR. Options, in order of increasing quality:

1. **html2canvas snapshot** — serialize the current `#screen-container` DOM to a `<canvas>` each frame via `html2canvas`. Apply as a Three.js texture on a plane. Input: XR controller ray → UV coordinate on plane → synthesized `MouseEvent` dispatched to the underlying HTML element. Fast to implement, not pixel-perfect, interaction latency is noticeable.

2. **Custom canvas-rendered screens** — each screen gets a `drawToCanvas(ctx: CanvasRenderingContext2D)` method alongside its existing HTML `mount()`. In XR mode the canvas version is used instead of DOM injection. More work upfront but crisp output and snappy interaction. The tuner canvas is already done this way.

3. **Per-device DOM overlay** — `immersive-ar` sessions on some devices (Android Chrome) support a `dom-overlay` layer that floats the real HTML over the XR view. Not available on closed VR headsets (Quest). Not a general solution.

**Recommendation:** start with option 1 for a proof of concept. Migrate screens to option 2 one at a time as polish is needed.

Panel B is a sibling of Panel A under the world anchor but has its own local transform offset. This lets the user nudge it independently (slide it to one side, angle it slightly) without moving the highway. On recenter, Panel B's local offset resets to a default (e.g. centred, same plane as Panel A, or slightly to the left).

When the active scene is entered, Panel B fades out (opacity to 0 over 0.3 s) and Panel A becomes the focus. On exit back to library, Panel B fades back in.

---

#### Gizmo

A `XRGizmo` attached to the world anchor provides axis-constrained transform handles:
- **Translate handles** — three arrows along X/Y/Z (red/green/blue)
- **Rotate handles** — three rings for pitch/yaw/roll (matching colours)

Handles are `THREE.Mesh` objects, ray-cast tested against both XR controller rays each frame. On `selectstart` over a handle: record controller pose and anchor transform; on controller move, compute the delta and apply constrained offset to the anchor. On `selectend`: finalise.

**Free grab** is also supported — point at either panel (not a handle), hold trigger, move. The panel follows the controller freely. On release it stays where it was; this is the quickest way to gross-reposition the experience.

Panel B has a secondary smaller gizmo (translate only, no rotation) for its local offset within the anchor. This lets the user position it comfortably relative to the highway without affecting the highway itself.

Gizmos are toggled on/off via a small HUD button on each panel. Hidden by default.

---

#### HUD bar

A thin bar along the bottom edge of each panel (a separate small `PlaneGeometry` with canvas texture buttons). Ray-cast interactive.

**Highway panel HUD:** `[▶/⏸]  [seek]  [speed]  [↺ Recenter]  [⊕ Gizmo]  [✕ Exit VR]`
**2D panel HUD:** `[↺ Recenter]  [⊕ Gizmo]  [Reset sub-position]`

---

#### New files

| File | Responsibility |
|---|---|
| `XRManager.ts` | Session lifecycle, `enterXR()` / `exitXR()`, controller setup, `isActive` getter |
| `XRWorldScene.ts` | The Three.js scene that XR cameras render; owns the world anchor and both panels |
| `XRPanel.ts` | One panel instance: render target (or canvas texture), mesh, HUD bar, free grab |
| `XRGizmo.ts` | Translate/rotate handles, ray-cast hit test, constrained drag logic |
| `XRInput.ts` | Controller ray meshes, `selectstart`/`selectend` routing to panels and gizmo |

`App.ts` gains `enterXR()` and `exitXR()` which delegate to `XRManager`. All other files are unaware of XR.

---

#### IWSDK — open question

Meta's Immersive Web SDK (`github.com/meta-quest/immersive-web-sdk`, MIT) is built on Three.js and defines exactly the interaction patterns needed: ray interaction, one-hand grab, two-hand grab, distance grab, poke, haptics. If its interaction layer can be ticked alongside an existing Three.js scene without taking over the renderer or render loop, it could replace most of `XRInput.ts` and `XRGizmo.ts`.

**The unresolved question:** does IWSDK require full ECS adoption (registering scene objects as entities in their world, handing over the render loop), or does it just need to be updated each frame alongside existing code? If the latter, it slots in cleanly. If the former, the rewrite cost isn't worth it and the grab logic should be reimplemented directly (~30 lines, see gizmo plan above).

**To investigate before writing XR interaction code:** find an IWSDK example project and check whether it constructs `new THREE.WebGLRenderer()` itself or accepts an externally-created renderer. That single question determines whether IWSDK is usable here.

---

#### Future: immersive mode

Once the panel model is working, a second mode can be added: the XR cameras replace `FretCamera` entirely and the player stands inside the highway at real scale. Notes scroll toward them at 1:1 size. This is a toggle in the HUD, not a separate flow.

---

### Piano positioning + spatial anchors
In XR mode, let the user position the keyboard instrument in physical space using spatial anchors (WebXR Anchors API). The piano would sit at a fixed real-world location across sessions. Requires a headset with 6DOF tracking (Quest 3, etc.).

With the panel model established, the keys scene would be Panel A for keyboard songs — the same anchor and gizmo infrastructure applies. Spatial anchors would persist the anchor's world transform between sessions so the instrument reappears in the same physical location.

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
- **WebXR** is exploratory; start with a `renderer.xr.enabled = true` toggle before committing to full spatial UI.
- **Piano samples** + **MIDI input** are natural partners — do them together.
- **Multiplayer** has no server requirement for the core experience — WebRTC peer-to-peer keeps it self-hostable. The signalling step is the only external dependency and can start as a copy-paste code exchange.
