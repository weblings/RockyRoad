# ChartPlayer → Three.js Implementation Plan

## Guiding principles

- Each phase ends with something **visually demonstrable**
- Later phases never break earlier ones — each is additive
- Audio and scoring are isolated concerns that slot in without restructuring the renderer
- Start with the simplest scene (Keys) to validate the architecture before the most complex (Fret)
- Drum scene and input scoring are stretch goals — the core product is a working guitar/keys visualizer

---

## Phase 1 — Rendering Core

**Goal:** Draw colored, textured quads in Three.js. Nothing song-specific.

**Relevant analysis:** [Scene3D.md](Scene3D.md)

**Files to write:**
- `ThreeCP/App.ts` — thin application shell (see below)
- `ThreeCP/UIColor.ts` — RGBA color type with helpers
- `ThreeCP/UIImage.ts` — atlas image descriptor type + image registry
- `ThreeCP/QuadBatch.ts` — dynamic `BufferGeometry` with pre-allocated `Float32Array` buffers; `begin()` / `addQuad()` / `draw()` cycle
- `ThreeCP/Camera3D.ts` — already written; wraps `THREE.PerspectiveCamera`
- `ThreeCP/Scene3D.ts` — receives renderer from App; exposes `drawQuad()`, `drawNinePatch()`
- `tools/bake-manifest.ts` — one-time build script to convert `ImageManifest.xml` → `public/ImageManifest.json`

---

### Build tooling

**Vite + TypeScript.** `npm create vite@latest three-cp -- --template vanilla-ts`, add `three` as a dependency. No unusual configuration needed.

---

### Texture atlas

`UISheet0.png` already exists at `ChartPlayerShared/Content/Textures/UISheet0.png` and is a standard 1024×1024 PNG — directly loadable by `THREE.TextureLoader`. No extraction or format conversion needed.

`ImageManifest.xml` is **baked to JSON** as a one-time build step (`tools/bake-manifest.ts`). This avoids an XML parser dependency at runtime and has zero cost after the first run. Output shape:

```json
{
  "sheets": [{
    "name": "UISheet0",
    "width": 1024,
    "height": 1024,
    "images": {
      "GuitarGreen": { "x": 257, "y": 730, "w": 52, "h": 24 },
      ...
    }
  }]
}
```

At startup, `fetch("ImageManifest.json")` populates a `Map<string, UIImage>`. `getImage(name)` is a simple map lookup.

---

### UIColor

`UIColor` is `{ r: number, g: number, b: number, a: number }` where all values are **0–1 floats** throughout. The original C# type has both byte (0–255) and float constructors — for the renderer, only the float representation matters since values go directly into `Float32Array` buffers and the shader. A small module provides named constants and helpers:

```ts
const White: UIColor = { r:1, g:1, b:1, a:1 };
const Black: UIColor = { r:0, g:0, b:0, a:1 };
function lerp(a: UIColor, b: UIColor, t: number): UIColor
function multiplyScalar(c: UIColor, s: number): UIColor
```

---

### Per-vertex alpha — custom ShaderMaterial

Three.js `MeshBasicMaterial` with `vertexColors: true` only reads RGB from the color attribute — alpha is ignored. Alpha is used heavily throughout (beat lines at 50% opacity, half-alpha white, etc.), so a custom `ShaderMaterial` is required.

The color attribute is a `Float32Array` of **4 floats per vertex** (RGBA). The shader is minimal — texture sample multiplied by vertex color including alpha:

```glsl
// vertex
attribute vec4 color;
varying vec4 vColor;
varying vec2 vUv;
void main() {
    vColor = color;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// fragment
uniform sampler2D map;
varying vec4 vColor;
varying vec2 vUv;
void main() {
    gl_FragColor = texture2D(map, vUv) * vColor;
}
```

This shader replaces `MeshBasicMaterial` as the material for the QuadBatch mesh. Render state is set on the material: `transparent: true`, `depthWrite: false`, `depthTest: false`, `side: THREE.DoubleSide`.

---

### Index buffer

The C# code uses 16-bit indices (`IndexElementSize.SixteenBits`) but pre-allocates 43,688 quads × 4 vertices = 174,752 vertices, which overflows uint16 (max 65,535). This is a latent bug in the original that works in practice only because the actual per-frame quad count never approaches the limit.

The TS port uses **`Uint32Array`** for the index buffer. WebGL2 supports 32-bit indices natively and is available in all modern browsers (Three.js creates a WebGL2 context by default). `maxQuads` should be revisited once actual per-frame usage is measured — 43,688 is almost certainly over-allocated.

---

### App layer — thin shell now, not Phase 6

Rather than having `Scene3D` own the renderer and `requestAnimationFrame` loop, a minimal `App` class is written in Phase 1. This is approximately 30 lines and cleanly separates concerns from the start, avoiding a refactor when `App` gains real features in Phase 6.

**Phase 1 scope of App — renderer, loop, resize only:**

```ts
class App {
    readonly renderer: THREE.WebGLRenderer;
    activeScene: Scene3D | null = null;
    private lastTime = 0;

    constructor(canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(devicePixelRatio);
        new ResizeObserver(() => this.onResize()).observe(canvas);
        this.onResize();
        requestAnimationFrame(t => this.loop(t));
    }

    private loop(time: number): void {
        const dt = Math.min((time - this.lastTime) / 1000, 0.1);
        this.lastTime = time;
        this.activeScene?.draw(dt);
        requestAnimationFrame(t => this.loop(t));
    }

    private onResize(): void {
        const w = this.renderer.domElement.clientWidth;
        const h = this.renderer.domElement.clientHeight;
        this.renderer.setSize(w, h, false);
        this.activeScene?.camera.setViewport(w, h);
    }
}
```

`dt` (delta time in seconds) is computed once here and passed into `draw(dt)` — this is what makes the Phase 5 frame-rate independent lerp fix possible without any further structural changes.

`activeScene` is a slot that Phase 6 will populate based on which song and instrument is selected. In Phase 1 it's set directly in `main.ts` for testing.

**Why not just a canvas element with Scene3D owning the renderer:**
- Scene3D would need to be refactored in Phase 6 to give up renderer ownership
- `dt` calculation would need to be added somewhere in the chain anyway
- Resize logic would live inside the rendering class rather than the application shell

The 30 lines cost in Phase 1 buys a clean architecture for all subsequent phases.

---

**Deliverable:** A browser page that draws test quads from the real texture atlas with a movable camera. Validates the full rendering pipeline — shader, atlas UVs, vertex colors with alpha, camera matrices — before any chart data is involved.

---

## Phase 2 — Song Data + The Highway

**Goal:** Load a real song's JSON files and render the beat grid scrolling.

**Relevant analysis:** [ChartScene3D.md](ChartScene3D.md)

**Files to write:**
- `ThreeCP/SongFormat.ts` — TypeScript interfaces mirroring the `SongFormat` types (`SongBeat`, `SongStructure`, `ISongEvent`, etc.). The JSON files on disk are already the right format — no conversion logic needed, just type declarations.
- `ThreeCP/ChartScene3D.ts` — time tracking, `getStartNote()` / `getEndNote()`, `drawBeats()`
- `ThreeCP/MathUtil.ts` — `lerp()`, `clamp()` — small utilities used everywhere

**Mock time provider:** A simple `let currentSecond = 0` incrementing each `requestAnimationFrame`. No audio yet.

**Deliverable:** The beat grid highway scrolls at real BPM from a loaded song file. Validates the time→Z formula and note windowing before any instrument-specific rendering.

---

## Phase 3 — Keys Scene

**Goal:** Full piano keyboard visualization from real song data.

**Relevant analysis:** [PlayerScenes.md](PlayerScenes.md), [NoteDetector.md](NoteDetector.md)

**Files to write:**
- `ThreeCP/NoteUtil.ts` — MIDI note → frequency, note names, semitone math. Pure logic, no dependencies.
- `ThreeCP/KeysPlayerScene3D.ts` — camera update, `getKeyPosition()`, key lane lines, note trail drawing

**Why Keys first:**
- No note detection or scoring
- No subclassed camera (just direct `position.set` + `lookAt` each frame)
- Simplest draw primitives — flat trails on the XZ plane, no billboarding
- Clean piano layout math that validates the coordinate system before tackling frets

**Deliverable:** A piano roll highway scrolling through a real song's keyboard data. First time the output resembles the actual application.

**Note:** The keys camera positioning should be revisited after Phase 5 (Fret). The C# `FretCamera` has dynamic zoom that tracks the live min/max fret range — keys has no equivalent and uses a fixed range. Once the fret camera pattern is understood in practice, consider back-porting a similar dynamic-range approach to `KeysPlayerScene3D`.

---

## Phase 4 — Audio

**Goal:** Songs actually play. Visual sync with real audio.

**Relevant analysis:** [SongPlayer.md](SongPlayer.md)

**Files to write:**
- `ThreeCP/SongPlayer.ts` — thin wrapper around `AudioContext`:
  - `loadSong(url)` — `fetch` + `decodeAudioData`
  - `play()` / `pause()` / `seekTo(seconds)`
  - `currentSecond` — derived from `audioContext.currentTime - startTime`

**Key simplification:** The C# `SongPlayer` decodes the entire song upfront into raw sample arrays and manages its own playback loop. The browser version delegates all of that to `AudioContext` — the only output the rendering pipeline needs is `currentSecond`.

**Architectural decisions:**

- **`currentSecond` injection** — `ChartScene3D.currentSecond` stays a public field set from outside. `App` owns `SongPlayer` and sets it each frame before calling `draw()`. Constructor injection was rejected: it would couple scene construction to a live audio session, making it impossible to create scenes before a song is loaded or swap songs without rebuilding the scene. This is consistent with `App` already owning the renderer and injecting it into scenes. The `+= dt` mock in `ChartScene3D.draw()` can be removed once `App` always manages the field.

- **Seek pattern** — `AudioBufferSourceNode` is fire-and-forget. `pause()` records `pausedAt`, calls `stop()`. `play()` / `seekTo(s)` creates a new source node and calls `start(0, offset)`.

- **Audio format** — Song files are `.ogg` (Ogg Vorbis, 48kHz stereo). `AudioContext.decodeAudioData` handles this natively — no decoder library needed.

- **Clock accuracy** — `currentSecond` derives from `audioContext.currentTime - startTime` (hardware clock), not accumulated `dt`. The `dt` approach drifts over long songs.

Replace the mock time provider from Phase 2 with this. No other rendering code changes.

**Deliverable:** Songs play with synchronized note scrolling. First complete end-to-end experience.

---

## Phase 5 — Fret Scene

**Goal:** Guitar and bass fret visualization.

**Relevant analysis:** [PlayerScenes.md](PlayerScenes.md), [Camera3D.md](Camera3D.md)

**Files to write:**
- `ThreeCP/FretCamera.ts` — smooth-tracking camera with lerp-based animation
- `ThreeCP/FretPlayerScene3D.ts` — fret drawing, string colors, note trails, chord display, hand position areas

**Important:** The frame-rate dependent lerps in `FretCamera.Update()` must be fixed here. In the original code, `lerp(a, b, 0.01)` assumes 60fps. In the browser, lerp rate must be scaled by `dt` (seconds elapsed since last frame):
```ts
// C# (frame-rate dependent):
cameraDistance = lerp(cameraDistance, target, 0.01);

// TS (frame-rate independent):
const rate = 1 - Math.pow(1 - 0.01, dt * 60);
cameraDistance = lerp(cameraDistance, target, rate);
```

No note detection yet — `notesDetected[]` stays null. Notes display but aren't scored.

---

### Phase 5 — Detailed component breakdown (from full C# source analysis)

#### FretCamera
- `Update(minFret, maxFret, targetFocusFret, focusY)` — called every frame from `updateCamera`
- `targetCameraDistance = 65 + max(fretDist - 12, 0) * 3` where `fretDist = maxFret - minFret`
- `positionFret` lerps at 0.02/frame (dt-correct to `1 - pow(0.98, dt*60)`)
- `cameraDistance` lerps at 0.01/frame (dt-correct to `1 - pow(0.99, dt*60)`)
- `fretOffset = (10 - positionFret) / 4` — camera leans toward high strings
- Position: `(GetFretPosition(positionFret + fretOffset), 50, focusY + cameraDistance)`
- LookAt: `(GetFretPosition(positionFret), 0, position.Z - focusDist * 0.3)` where `focusDist = 600`
- `targetPositionFret` is clamped: must stay within `[targetFocusFret - 3, targetFocusFret + 5]`

#### GetFretPosition (static, shared)
```ts
const scaleLength = 300;
function getFretPosition(fret: number): number {
    return scaleLength - scaleLength / Math.pow(2, fret / 12);
}
```
Exported from `FretPlayerScene3D.ts` — used by both the scene and `FretCamera`.

#### Drawing primitives needed (new in this scene)
- `drawFretTimeLine(fret, height, startTime, endTime, color)` — lane divider, same pattern as keys
- `drawFretHorizontalLine(startFret, endFret, time, heightOffset, color, imageScale)` — string lines / note shadows
- `drawFretVerticalLine(fretCenter, time, startHeight, endHeight, color, imageScale)` — beat lines spanning height
- `drawVerticalImage(image, startFret, endFret, time, heightOffset, color, imageScale)` — note head facing camera (XY plane) — **3 overloads**
- `drawFlatImage(image, fretCenter, startTime, endTime, heightOffset, color, imageScale)` — note trail — **2 overloads**
- `drawVerticalNinePatch(image, startFret, endFret, time, startHeight, endHeight, color)` — chord outline box
- `drawImageTrail(image, color, imageScale, ...points)` — slide trail (2 Vec3 points in practice)
- `drawVibrato(image, fretCenter, startTime, endTime, heightOffset, color)` — sinusoidal trail, ~50 quads/note
- `drawBend(image, fretCenter, startTime, sustain, stringIdx, centsOffsets, color)` — vertically displaced trail following CentsOffset array

#### String layout
```ts
// 7 colors cycling for 6-string (offset=1) or 4-string bass (offset=0 for B-tuning and below)
const STRING_COLORS = [green, red, yellow, cyan, orange, green, purple];
// offset=1 for guitar/standard bass, offset=0 for low-tuned bass
function getStringHeight(str: number): number { return 3 + str * 4; }
function getStringOffset(str: number): number { return invertStrings ? numStrings - str - 1 : str; }
```

#### Note draw loop — critical details
- Notes are drawn **in reverse** (from `lastNote` back to `startNotePosition`) so earlier notes render on top
- `minFret`/`maxFret` are reset to `[numFrets, 0]` each frame and accumulated during note drawing (feeds FretCamera)
- `firstNote` tracks the earliest future note for `targetFocusFret`
- Hand position areas drawn as `SingleWhitePixel` flat images between hand-position-change events

#### Constructor pre-pass
Sorts notes by `TimeOffset` then by `GetStringOffset(String)` descending. Then builds:
- `nonRepeatChords[timeOffset]` — true when hand position changes or chord changes; controls when chord outlines/names re-display
- `nonRepeatNotes[timeOffset]` — true when fret changes; controls when fret numbers re-display

#### DrawSingleNote branches
- **Open string (fret == 0):** drawFret = HandFret + 1.5; uses wide note image spanning HandFret-1 to HandFret+3
- **Fretted:** standard position; if slide, `drawFret = lerp(note.Fret, note.SlideFret, t)` during playback
- **Sustain trail:** drawFlatImage (straight), drawImageTrail (slide), drawVibrato, or drawBend depending on techniques
- **Note head:** drawVerticalImage at `drawFret - 0.5`
- **Modifier image:** HammerOn, PullOff, Mute, PalmMute, Harmonic, PinchHarmonic overlaid on note head
- **Shadow:** `drawFretHorizontalLine` at `drawFret-1` to `drawFret` on the fretboard (Y=0)
- **String connector:** `drawFretVerticalLine` from Y=0 up to note head height

#### SongFormat additions required
- `CentsOffset: { TimeOffset: number, Cents: number }` — bend data point
- `ESongNoteTechnique` bitmask: `HammerOn=2, PullOff=4, Accent=8, PalmMute=16, FretHandMute=32, Slide=64, Bend=128, Vibrato=512, Harmonic=1024, PinchHarmonic=2048, Chord=32768, ChordNote=65536, Continued=131072`
- `SongNote.CentsOffsets: CentsOffset[] | null` — missing from current SongFormat.ts
- `SongChord.Fingers: number[]` and `SongChord.Frets: number[]` — check if already in SongFormat.ts

#### Settled omissions for Phase 5
- **NoteDetector / scoring** — `isDetected = false` always; "GuitarDetected" image never draws; no `notesDetected[]` array
- **invertStrings** — hardcode `false`; Phase 6 adds settings UI
- **capoFret** — hardcode `0`; drawn as a thick vertical line if nonzero
- **Text rendering** (`drawVerticalText`, `drawFlatText`) — **DEFERRED to Phase 6**: skipped for Phase 5. Visually acceptable without it.

#### Phase 5 text rendering decision (settled)
The font images (`LargeFont`, `MainFont`) ARE in UISheet0.png as sprite regions, but we don't have the glyph-mapping data (character → pixel offset) that the MonoGame SpriteFont provides at runtime. Without it we can't pick individual characters out of the 506×661 font sprite.

**Phase 6 options for text:**
- **(A) Three.js TextGeometry** — https://threejs.org/docs/#TextGeometry — renders text as 3D geometry from a loaded font (JSON typeface format). Stays inside the WebGL context; no DOM required. Clean for in-world labels (fret numbers, chord names in 3D space).
- **(B) HTML overlay** — CSS-positioned `<div>` elements over the canvas, positions projected from 3D world space using `vec.project(camera)`. Simple but creates a DOM-WebGL sync concern each frame.
- **(C) Canvas 2D texture atlas** — pre-render characters to a canvas, use as a dynamic texture. Most work; only justified if TextGeometry is too heavy.

**Recommendation for Phase 6:** Try Three.js TextGeometry first — it integrates naturally with the existing quad-based renderer.

**Deliverable:** Guitar and bass charts render and scroll. FretCamera smoothly tracks the active fret region.

---

## Phase 6 — UI Shell

**Goal:** A usable browser application, not just a renderer demo.

**Relevant analysis:** [ChartPlayerGame.md](ChartPlayerGame.md), [SongPlayer.md](SongPlayer.md)

**Files to write:**
- `ThreeCP/App.ts` — application shell (equivalent of `ChartPlayerGame`):
  - Creates `THREE.WebGLRenderer`, appends canvas to DOM
  - Owns the `requestAnimationFrame` loop
  - `ResizeObserver` for responsive canvas
  - Coordinates active scene, audio player, and input
- HTML/CSS for:
  - Song browser (file picker or directory listing)
  - Playback controls (play/pause, seek, speed)
  - Instrument / arrangement selector
  - Settings (lefty mode, note display length, `SongPlayerSettings`)

**`SongPlayerSettings`** ports as a plain TS interface with `localStorage` for persistence. The reflection-based settings UI from C# (`PropertyInfo.SetValue`) is replaced with standard HTML form elements.

**Deliverable:** A complete, navigable application. Load a song folder, pick an instrument, watch it play.

---

## Stretch Goal A — Drum Scene + Web MIDI

**Relevant analysis:** [PlayerScenes.md](PlayerScenes.md), [MidiMap.md](MidiMap.md)

**Files to write:**
- `ThreeCP/MidiMap.ts` — `DrumVoice`, `DrumHit`, `DrumMidiDeviceConfiguration`; config stored as JSON in `localStorage`
- `ThreeCP/DrumPlayerScene3D.ts` — lane layout, note/cymbal drawing, kick line, hit flash

**Why it's a stretch goal:**
- The fret and keys scenes cover the primary use case
- Drum scoring works differently (MIDI event matching rather than audio analysis) — it's more self-contained, but adds Web MIDI API dependency and MIDI config UI complexity

**Web MIDI replaces the DAW plugin callback:**
```ts
const midi = await navigator.requestMIDIAccess();
for (const input of midi.inputs.values()) {
    input.onmidimessage = (e) => {
        const [status, note, velocity] = e.data;
        if ((status & 0xF0) === 0x90 && velocity > 0)
            scene.handleNoteOn(status & 0x0F, note, velocity / 127, 0);
    };
}
```

**Note:** `DrumPlayerScene3D` has no dependency on `FretPlayerScene3D` — this can be built independently after Phase 4.

---

## Stretch Goal B — Guitar Scoring (Note Detection)

**Relevant analysis:** [NoteDetector.md](NoteDetector.md)

**Files to write:**
- `ThreeCP/SampleHistory.ts` — `SharedArrayBuffer`-backed ring buffer
- `ThreeCP/NoteDetector.ts` — Web Worker running FFT pitch detection at ~50ms intervals

**Requires:**
- Microphone access via `getUserMedia({ audio: true })`
- `AudioWorkletProcessor` to fill the sample ring buffer from the live audio stream
- A JS or WASM pitch detection library (e.g. `pitchfinder`, or custom autocorrelation)

**Isolated behind a feature flag** — everything from Phases 1–6 works without it. `notesDetected[]` in `FretPlayerScene3D` simply stays null when scoring is disabled.

---

## Summary

| Phase | Key files | Deliverable |
|---|---|---|
| 1 | `App`, `UIColor`, `UIImage`, `QuadBatch`, `Camera3D`, `Scene3D` | Textured quads in browser |
| 2 | `SongFormat`, `ChartScene3D`, `MathUtil` | Beat grid from real song data |
| 3 | `KeysPlayerScene3D`, `NoteUtil` | Full piano visualization |
| 4 | `SongPlayer` | Synced audio + visuals |
| 5 | `FretCamera`, `FretPlayerScene3D` | Guitar/bass visualization |
| 6 | `App`, HTML/CSS shell | Complete navigable application |
| Stretch A | `DrumPlayerScene3D`, `MidiMap` | Drum visualization + MIDI scoring |
| Stretch B | `NoteDetector`, `SampleHistory` | Guitar scoring via microphone |
