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

#### Toggles added in Phase 5 / deferred to settings UI

**`FretPlayerScene3D.boldText`** (added Phase 6.1, default `true`)
Public field on `FretPlayerScene3D`. When `true`, all in-world text labels use `LABEL_WHITE` (`#E8E8E8`) with a dark stroke for high contrast. When `false`, reverts to C#-faithful behavior: labels are bright white only within the current hand-position range, and dimmed (25% alpha) outside it. Wired to a settings toggle in Phase 6.5.

**Skip-to-first-note** (deferred — not yet a proper toggle)
Songs often have a silent intro before the first note. The desired behavior: when enabled, automatically seek the player (and scene `currentSecond`) to `instrumentNotes.Notes[0].TimeOffset` at song load. Currently approximated by a manual `PREVIEW_OFFSET` constant in `main.ts`. Phase 6.3 or the settings UI should expose this as a boolean — `skipIntro` — computed as:
```ts
const skipTarget = scene.instrumentNotes.Notes[0]?.TimeOffset ?? 0;
if (settings.skipIntro && skipTarget > 0) {
    songPlayer.seekTo(skipTarget);
    scene.currentSecond = skipTarget;
}
```
Should be opt-in (default off) since some songs have meaningful audio before the first note.

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

**Work order within Phase 6:**
1. Text rendering (in-world fret numbers, chord names) — ✅ done
2. App.ts upgrade — widen `activeScene` type, coordinate scene creation from selection — ✅ done
3. Song library screen (folder picker, song cards) — ✅ done
4. Pre-scene screen (instrument selector, key settings) — ✅ done
5. Tuner / input-check scene — deferred
6. Active scene overlay (playback controls, seek bar, speed control) — ✅ done
7. Shared settings panel

---

### User flow (agreed)

```
[App loads]
    │
    ├─ No library configured ──→ [Welcome screen]
    │                             "Choose your songs folder" button
    │                             └──→ [Folder picker dialog]
    │                                         │
    └─ Library stored ───────────→ [Song library]  ◄──────────────────────────────┐
                                    • Cards: album art, title, artist,             │
                                      tuning, available arrangements               │
                                    • Search / filter (stretch)                    │
                                            │                                      │
                                      [Pick a song]                                │
                                            │                                      │
                                   [Pre-scene screen]                              │
                                    • Song title + artist                          │
                                    • Instrument selector (Lead/Rhythm/            │
                                      Bass/Keys/Drums — only show what             │
                                      the song has)                                │
                                    • Key toggles: skip intro, bold text           │
                                    • [Play] button                                │
                                            │                                      │
                                   [Tuner scene — guitar/bass only]                 │
                                    • Chromatic tuner (mic → pitch display)        │
                                    • [Skip (I'm in tune)] + auto-advance          │
                                    • Keys/drums skip this step entirely           │
                                            │                                      │
                                   [Active scene]                                  │
                                    • Play/pause, seek bar, time display           │
                                    • [⚙ Settings] → same settings panel          │
                                    • [Back to library] ───────────────────────────┘
```

---

### Global chrome

A **⚙ gear icon** is always present in the top-right corner across every screen (library, pre-scene, tuner, active scene). It opens the shared settings panel. This is a single persistent DOM element at the App level, overlaid above everything else — not duplicated per screen.

---

### Settings panel (shared across screens)

Opened via the persistent top-right gear icon from any screen. Single panel, same content everywhere.

**Presentation:**
- Rendered as a modal window on top of whatever screen is currently showing
- A dark scrim (`rgba(0,0,0,0.6)` full-screen div) sits between the current screen and the panel, providing contrast and indicating the screen below is inactive
- Clicking the scrim closes the panel (same as a cancel/close button)
- Both the scrim and the panel are removed from the DOM when the panel closes — the underlying screen is fully visible again immediately

**Behaviour when opened during an active song:**
- Song is paused immediately when the panel opens
- The Three.js canvas continues rendering the paused frame behind the scrim (scene stays alive, just not advancing)

**Behaviour when dismissed during an active song ("Continue" button):**
1. Seek back 3 seconds: `songPlayer.seekTo(Math.max(0, pausedAt - 3))`; update `scene.currentSecond` to match
2. Display a countdown overlay (DOM, centered on canvas): **3 → 2 → 1** with one digit per second
3. After the countdown reaches 0, call `songPlayer.play()` — playback resumes
4. Countdown is implemented in `App.ts` as a simple `setTimeout` chain; the countdown digit is a CSS-animated DOM element so it doesn't require Three.js text machinery

**Behaviour when dismissed outside of an active song** (library, pre-scene, tuner):
- Panel simply closes, no countdown, no seek

**Global settings (Phase 6):**
- `invertStrings` — boolean
- `boldText` — boolean (default on; see Phase 5 toggle notes)
- `skipIntro` — boolean (default off; see Phase 5 toggle notes)
- `leftyMode` — boolean
- `tunerAutoAdvance` — boolean (default on); when off, tuner completion shows a button instead of auto-proceeding after the ✓ graphic
- **"Tune" button** — opens the tuner in the appropriate context; only shown when the active instrument is guitar/bass (stringed); added in Phase 6.5

**Stretch settings (document now, build later):**
- `playbackSpeed` — float 0.5–1.0 (requires WASM time-stretcher; see Phase 6.4 deferred)
- `noteDisplaySeconds` — float, default 4.0
- `practiceMode` — boolean; enables loop markers and per-section repeat (see stretch goal below)

---

### Phase 6.1 — In-world text rendering

**What's needed in `FretPlayerScene3D`:**

All five call sites use `DrawVerticalText` (XY plane, facing camera). `DrawFlatText` is defined in C# but never called — skip it entirely.

| Call | Content | Scale | Notes |
|---|---|---|---|
| On-fretboard number (individual note) | fret digit, e.g. `"7"` | 0.12 | At note's TimeOffset, Y=0 |
| On-fretboard number (chord per-string) | fret digit | 0.12 | At note's TimeOffset, Y=0 |
| On-fretboard number (during current chord) | fret digit | 0.08 | At currentTime, Y=0 |
| Finger overlay on current note head | finger digit `"1"`–`"4"` | 0.05 | At note head height |
| Chord name | e.g. `"Am"`, `"Cadd9"` | 0.09 | Right-aligned, at top string height |

**Chosen approach: `THREE.Sprite` with pooled `CanvasTexture`**

- `THREE.Sprite` auto-billboards to face the camera — better than the C# XY-plane approach (always readable regardless of camera angle)
- Canvas 2D `fillText()` renders text into an offscreen canvas → `THREE.CanvasTexture`
- Textures are **cached by key** (`"${text}:${r},${g},${b}"`) — fret digits 0–24 and common chord names are reused every frame at zero cost
- Sprites are **pooled** — a fixed array of `THREE.Sprite` instances, reset each frame by hiding all, then shown as `drawText()` is called
- Right-alignment: `sprite.center.set(1, 0.5)` shifts the sprite anchor to its right edge

**`TextBatch.ts`** — new file, parallel to `QuadBatch`:
```ts
class TextBatch {
    private sprites: THREE.Sprite[] = [];
    private used = 0;
    private cache: Map<string, THREE.CanvasTexture> = new Map();

    begin(): void  // hide all sprites, reset used=0
    drawText(text, position, color, worldSize, rightAlign?): void  // grab/create sprite, position it
    // called from Scene3D; sprites are already in the THREE.Scene
}
```

Canvas texture size: 256×64 px canvas for most labels. World size (sprite scale) derived from `imageScale` parameter × a world-unit constant (TBD via visual tuning).

**Integration into `Scene3D`:**
- `Scene3D` owns a `TextBatch` alongside the `QuadBatch`
- `Scene3D.drawQuads()` is currently the override point; the text batch `begin()` / draw calls / (no explicit flush — sprites stay visible until next `begin()`) wrap the same frame

**`FretPlayerScene3D` additions:**
- `drawVerticalText(text, fretCenter, verticalCenter, timeCenter, color, imageScale, rightAlign?)` — mirrors C# signature, calls `textBatch.drawText()`
- Replace the five `// Text: ... skipped` comments with real calls

**Rejected alternatives:**
- *Three.js TextGeometry* — vector fonts are crisp but each geometry build is slow; a new geometry per unique string per frame is not viable for dynamic text. Would only make sense with pre-built geometry for every possible fret label (25 digits), but still can't handle arbitrary chord names.
- *HTML overlay* — DOM-WebGL sync concern each frame; also CSS positioning requires `vec.project(camera)` per label and breaks if canvas is scaled.

---

### Phase 6.2 — App.ts restructure (application router) ✅

Phase 6 turns `App` from a thin renderer shell into the application router. This is the most structural change in the whole port.

**DOM layout (set up once in `App` constructor):**
```html
<body>
  <canvas id="canvas" />          <!-- always present; black when no scene active -->
  <div id="screen-container" />  <!-- screens mount/unmount here -->
  <button id="settings-btn">⚙</button>   <!-- persistent top-right -->
  <div id="settings-overlay" />  <!-- scrim + panel; hidden by default -->
  <div id="countdown-overlay" /> <!-- 3-2-1 countdown; hidden by default -->
</body>
```

**Screen interface — each screen is a class with a mount/unmount lifecycle:**
```ts
interface IScreen {
    mount(container: HTMLElement): void | Promise<void>;  // async screens fire-and-forget
    unmount(): void;
}
```

Screens:
- `SongLibraryScreen` — pure HTML, no Three.js
- `PreSceneScreen` — pure HTML, no Three.js
- `TunerScreen` — HTML; no Three.js scene required
- `ActiveSceneScreen` — creates + owns the Three.js scene and SongPlayer; HTML overlay on top

**`App` public API:**
```ts
class App {
    navigate(screen: IScreen): void   // unmount current → mount new
    openSettings(): void              // show scrim + panel; pause song if active
    closeSettings(): void             // hide scrim + panel; start countdown if song was playing
    private startCountdown(onComplete: () => void): void  // 3-2-1 then callback
}
```

**`App` hooks set by `ActiveSceneScreen`** (cleared on unmount):
- `onPreDraw: (() => void) | null` — called each RAF tick; injects `currentSecond` from `SongPlayer`
- `onSongPause: (() => number | null) | null` — pauses song if playing, returns position; null if already paused
- `onSongResume: ((seconds: number) => void) | null` — seeks + resumes after settings countdown

**Scene teardown on navigation:** `ActiveSceneScreen.unmount()` calls `scene.destroy()` and `songPlayer.pause()` before clearing `app.activeScene`. Prevents VRAM leaks when switching songs.

**Canvas clear on navigate:** `App.navigate()` calls `renderer.clear()` after unmounting the outgoing screen. Ensures the last rendered frame doesn't linger behind the next screen (e.g. fret notes visible behind the song library).

**Auto-play:** `ActiveSceneScreen` calls `songPlayer.play()` immediately after mounting the scene — no click required to start. Click-to-pause/resume on the overlay still works as before.

**`erasableSyntaxOnly` constraint:** TypeScript parameter properties (`constructor(private foo)`) are forbidden. All fields must be declared and assigned manually.

---

### Phase 6.3 — Song library screen ✅

**File system access — two backends behind `ISongLibrary`:**

Firefox does not support `showDirectoryPicker`. Rather than Chrome/Edge-only, we built a common abstraction:

```ts
interface ISongLibrary {
    scan(): Promise<SongIndexEntry[]>;
    getSongFile(entry: SongIndexEntry, filename: string): Promise<File>;
    getAlbumArtUrl(entry: SongIndexEntry): Promise<string | null>;
    readonly canPersist: boolean;
}
```

- **`HandleLibrary`** — Chrome/Edge. `showDirectoryPicker()` → `FileSystemDirectoryHandle`. Handle persisted in IndexedDB (inline wrapper, ~20 lines). On return: `queryPermission()` → if not granted, show "Re-allow access" button. `canPersist = true`.
- **`FileListLibrary`** — Firefox/all browsers. `<input type="file" webkitdirectory>` → `FileList`. Strips root folder segment from `webkitRelativePath` to build relative paths. No persistence — user re-picks each session. `canPersist = false`.
  - **Bug fix:** `getSongFile` constructs path as `` `${folderPath}/${filename}` `` — when `folderPath` is `''` (song at root of picked folder) this produces `'/filename'` which fails the `Map` lookup. Fixed to `` folderPath ? `${folderPath}/${filename}` : filename ``.

`SongLibraryScreen` detects `'showDirectoryPicker' in window` at module load and routes the button to the appropriate backend. Firefox welcome screen shows a note about re-picking.

`ActiveSceneScreen` takes `ISongLibrary` — no knowledge of which backend is active.

**`@types/wicg-file-system-access`** added to devDependencies. Must also be added to `tsconfig.json` `types` array (not just installed) since `types` is explicitly set to `["vite/client"]`.

**Folder structure (observed):** any depth — scanner recurses until it finds `song.json`.
- Album art: `albumart.png` (not `album.png`)
- Audio: `song.ogg`
- Instrument files: `{InstrumentName}.json` (e.g. `lead.json`, `bass.json`)

**Scan algorithm:** recursive. Any directory containing `song.json` is a song folder — do not recurse further. Directories without `song.json` are descended into at any depth.

**`SongIndexEntry` / `SongIndexPart` — final types:**
```ts
interface SongIndexEntry {
    folderPath: string;     // relative to library root, e.g. "boypablo/tkm"
    songName: string;
    artistName: string;
    albumName?: string;
    lengthSeconds: number;
    parts: SongIndexPart[];
}
interface SongIndexPart {
    type: string;       // "LeadGuitar" | "RhythmGuitar" | "BassGuitar" | "Keys" | "Drums" | "Vocals"
    name: string;       // "lead" | "bass" | etc. — used as instrument .json filename
    difficulty: number;
    tuning?: string;    // "E A D G B E" — only set for stringed instruments
}
```
Tuning display string derived from `StringSemitoneOffsets` using standard base MIDI notes per string count (4/5/6/7 string). A lookup table of common offset patterns maps to friendly names (e.g. "E Standard", "Drop D", "Eb Standard", "DADGAD", "Open G") before falling back to raw note letters for unrecognised tunings.

**Song library UI:**
- Search bar (title + artist + album), sort dropdown, instrument filter chips, per-instrument tuning dropdown
- Tuning dropdown only shown when a stringed instrument chip is selected
- Sort options for difficulty/tuning only shown when a relevant filter is active
- `SongLibraryState` persisted to `localStorage`
- Album art loaded async; object URLs tracked and revoked on unmount
- Card click → `ActiveSceneScreen` with first non-Vocals part (Phase 6.4 inserts instrument selection here)
- **Album art bug fix:** `refreshCards()` replaces `#lib-grid` innerHTML, wiping previously-injected `<img>` tags. Art URLs are stored in a `Map<number, string>` (song index → object URL) and `injectAlbumArts()` is called at the end of `refreshCards()` to re-inject after every filter/search/sort change.
- `SongLibraryScreen` accepts an optional `existingLibrary` constructor parameter — if provided, skips the welcome screen and goes straight to the song list. Used by the back button in `ActiveSceneScreen` so Firefox users aren't forced to re-import on every return navigation.

**`SongLibraryState`** — persisted to `localStorage`:
```ts
interface SongLibraryState {
    sortField: "title" | "artist" | "difficulty" | "tuning";
    sortAsc: boolean;
    instrumentFilter: "All" | "Lead" | "Rhythm" | "Bass" | "Keys" | "Drums";
    tuningFilter: string;           // "All" | specific tuning string; ignored when instrument has no tunings
    searchQuery: string;
}
```

**`SongPlayerSettings`** — split across two stores:
- `libraryHandle` — `FileSystemDirectoryHandle`, stored in **IndexedDB** via `idb-keyval`
- All other settings (`invertStrings`, `leftyMode`, `boldText`, `skipIntro`, `noteDisplaySeconds`) — plain JSON, stored in `localStorage`

---

### Phase 6.4 — Pre-scene screen ✅

Shown after picking a song, before entering the tuner/scene.

- Song title + artist (large)
- Album art
- Instrument selector — buttons for each available arrangement only (hidden when only one playable part)
- Key toggles inline: skip intro, bold text
- [Play] button — advances to active scene (Phase 6.5 tuner will be inserted here)

**Key decisions:**
- `PreSceneScreen` accepts `ISongLibrary` + `SongIndexEntry`; selected part tracked as local state, defaulting to first non-Vocals part.
- Back button lazy-imports `SongLibraryScreen` (same circular-dep avoidance pattern as `ActiveSceneScreen`), passing the existing library so the song list is restored without a re-scan.
- Instrument selector hidden entirely when only one playable part exists — no point showing a single button.
- `Settings.ts` introduced here: thin `loadSettings()` / `saveSettings()` over a single `localStorage` JSON key. Fields: `skipIntro` (default `false`), `boldText` (default `true`), `invertStrings` (default `false`), `leftyMode` (default `false`). `ActiveSceneScreen` reads settings on mount — `boldText` applied to scene field, `skipIntro` seeks `scene.currentSecond` to `Notes[0].TimeOffset` before playback starts (audio seek omitted — song auto-plays from 0, scene displays from first note). Settings panel (Phase 6.7) will write to the same store.
- Play button goes directly to `ActiveSceneScreen` for now; Phase 6.5 tuner will be inserted between them when tuning is required.
- **Phase 6.5 addition:** add a "Tune" button to `PreSceneScreen` that opens the tuner voluntarily; only shown when a stringed instrument (guitar/bass) is selected. Keys/drums have no tune button and skip straight to the active scene.

---

### Phase 6.5 — Tuner (guitar/bass only)

Full UX spec in `project_phase6_ux.md` (memory). This section is the implementation plan — architecture, data flow, and technical spec.

**Build order: flow first, pitch detection second.** Get navigation, state machine, and canvas drawing working with stubbed/random pitch data before wiring the Web Audio pipeline.

---

#### Files to write

- `ThreeCP/Project/src/TunerScreen.ts` — `IScreen` implementation; owns the canvas, state machine, and Web Audio nodes
- `ThreeCP/Project/src/PitchDetector.ts` — thin wrapper: `getUserMedia` → `AnalyserNode` → autocorrelation → `{ frequency: number, clarity: number } | null`

---

#### Step A — Flow (no audio)

Get the full navigation working with a stubbed pitch source before touching Web Audio.

**`SongIndexPart` extension (one-line change to `SongIndex.ts`):**

Add `tuningOffsets?: number[]` to `SongIndexPart` and populate it in `entryFromJson` (the raw `offsets` array is already available there — just store it alongside the display string). The tuner needs the raw offsets; the display string alone is insufficient.

```ts
interface SongIndexPart {
    // ... existing fields ...
    tuningOffsets?: number[];   // raw StringSemitoneOffsets; only set for stringed instruments
}
```

**`App.lastTuningKey` and `shouldAutoTune()`:**

```ts
// In App.ts
lastTuningKey: string | null = null;  // null = first song of session; updated on every tuner exit

shouldAutoTune(part: SongIndexPart): boolean {
    if (!part.tuningOffsets) return false;   // non-stringed; skip tuner
    return this.lastTuningKey !== JSON.stringify(part.tuningOffsets);
}
```

`PreSceneScreen.onPlay()` checks `app.shouldAutoTune(selectedPart)`:
- true → `app.navigate(new TunerScreen(app, 'song-flow', entry, selectedPart, library))`
- false → `app.navigate(new ActiveSceneScreen(app, entry, selectedPart, library))`

"Tune" button on `PreSceneScreen` always navigates to tuner with `'song-flow'` context (bypasses the `shouldAutoTune` check — user explicitly requested it).

**`TunerContext` type and `TunerScreen` constructor:**

```ts
type TunerContext = 'song-flow' | 'mid-song' | 'menu';

class TunerScreen implements IScreen {
    constructor(
        app: App,
        context: TunerContext,
        entry: SongIndexEntry,
        part: SongIndexPart,
        library: ISongLibrary,
    ) { ... }
}
```

Exit destinations by context (called after `app.lastTuningKey` is updated):
- `song-flow` → `app.navigate(new ActiveSceneScreen(...))`
- `mid-song` → `app.resumeWithCountdown(pausedAt)` (pausedAt passed via constructor from `ActiveSceneScreen`)
- `menu` → `app.navigate(previousScreen)` (previous screen instance passed via constructor)

**Controls (DOM, always visible):**
- Audio input `<select>` (populated after `enumerateDevices()`)
- Tuning override `<select>` (same lookup table as song library; default = song's own tuning)
- `[Restart]` button — reset to phase 1, string 0
- `[Skip (I'm in tune)]` button — `app.lastTuningKey = JSON.stringify(offsets)`; exit to destination

**Phase state machine (step A: stub pitch as `null`):**

```ts
type TunerPhase =
    | { tag: 'correction'; stringIndex: number }
    | { tag: 'validation'; stringIndex: number; results: boolean[] }
    | { tag: 'complete' };
```

`rAF` loop calls `tick(detectedCents: number | null)` each frame:
- `correction`: if `detectedCents != null && Math.abs(detectedCents) <= 10` → advance to next string or enter `validation`
- `validation`: within ±15 cents → mark pass and advance; fail → re-enter `correction` for that string only; all pass → `complete`
- `complete`: show ✓ "In tune!" graphic; if `tunerAutoAdvance` → wait 1 s then exit; else show context button

Strings are ordered lowest→highest (index 0 = thickest). `StringSemitoneOffsets[0]` = lowest string.

---

#### Step B — Canvas rendering

Standalone `<canvas>` element (not the Three.js canvas). Drawn each `rAF` tick via `ctx.clearRect` + immediate-mode 2D.

**String layout:**
- N strings drawn as horizontal lines, evenly spaced vertically, centered in the canvas
- Reuse the same colors as `FretPlayerScene3D` string colors (extract the color array to a shared constant or just hardcode: `['#FF4444', '#FFA500', '#FFFF00', '#00CC00', '#4444FF', '#FF88FF']` low→high)
- Canvas height ≈ 280px; string spacing ≈ `(canvasHeight - 60) / (N - 1)`; outermost strings have 30px top/bottom margin
- String note names (e.g. "E2", "A2", "D3") drawn at left edge, right-aligned before the string start
- Active string (Phase 1): drawn brighter, 3px wide vs 1.5px for others
- Passed strings (Phase 2): brief green flash on pass (draw green for ~300 ms, then return to normal color)

**Deviation indicator (only shown when pitch detected and not null):**
- A short horizontal white bar (80px wide, 3px tall) centered on the active string's X midpoint
- Vertical offset: `clamped(detectedCents, -50, 50) / 50 * (stringSpacing * 0.45)` — positive cents → upward (sharp), negative → downward (flat)
- When within ±10 cents: bar snaps to string Y, drawn green instead of white
- String turns green simultaneously

**"In tune!" overlay (complete state):**
- Large ✓ drawn via `ctx.fillText('✓', cx, cy)` at ~96px, color `#44FF44`
- `"In tune!"` text below at 32px
- CSS `opacity` transition handles the fade-out before auto-advance

---

#### Step C — Pitch detection (Web Audio)

Replace the stubbed `null` pitch with real autocorrelation output from `PitchDetector`.

**Web Audio pipeline:**

```ts
class PitchDetector {
    private ctx: AudioContext;
    private analyser: AnalyserNode;
    private buf: Float32Array;
    private stream: MediaStream;

    static async create(deviceId?: string): Promise<PitchDetector> {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;       // 1024 bins; time-domain buffer is also 2048 samples
        analyser.smoothingTimeConstant = 0;   // no smoothing — we want raw samples for autocorrelation
        source.connect(analyser);
        // do NOT connect analyser to ctx.destination — no mic monitoring
        return new PitchDetector(ctx, analyser, stream);
    }

    detect(): { frequency: number; clarity: number } | null {
        this.analyser.getFloatTimeDomainData(this.buf);
        return autocorrelate(this.buf, this.ctx.sampleRate);
    }

    destroy(): void {
        this.stream.getTracks().forEach(t => t.stop());
        this.ctx.close();
    }
}
```

**Autocorrelation algorithm:**

```ts
function autocorrelate(buf: Float32Array, sampleRate: number): { frequency: number; clarity: number } | null {
    const N = buf.length;

    // 1. RMS silence check — don't process if signal is below noise floor
    let rms = 0;
    for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / N);
    if (rms < 0.01) return null;   // silence

    // 2. Compute autocorrelation for lags [minLag, maxLag]
    //    Guitar low E ≈ 82 Hz → max lag = sampleRate / 82 ≈ 537
    //    Guitar high e ≈ 1319 Hz (no need to detect above ~1400) → min lag = sampleRate / 1400 ≈ 31
    //    Bass low B ≈ 31 Hz → max lag = sampleRate / 31 ≈ 1419
    const minLag = Math.floor(sampleRate / 1400);
    const maxLag = Math.ceil(sampleRate / 30);   // covers bass low B

    const r = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i < N - lag; i++) sum += buf[i] * buf[i + lag];
        r[lag] = sum;
    }

    // 3. Find first local maximum after first zero-crossing (fundamental period)
    let start = minLag;
    while (start < maxLag && r[start] > 0) start++;   // skip to first negative region
    let bestLag = start;
    for (let lag = start + 1; lag <= maxLag; lag++) {
        if (r[lag] > r[bestLag]) bestLag = lag;
    }

    // 4. Clarity = r[bestLag] / r[0] — confidence that the signal is periodic
    const clarity = r[bestLag] / r[minLag];   // relative to r[minLag] (near-zero lag)
    if (clarity < 0.85) return null;   // noisy / unpitched signal

    // 5. Parabolic interpolation for sub-sample accuracy
    const y0 = r[bestLag - 1], y1 = r[bestLag], y2 = r[bestLag + 1];
    const refinedLag = bestLag + (y0 - y2) / (2 * (2 * y1 - y0 - y2));

    return { frequency: sampleRate / refinedLag, clarity };
}
```

**Frequency → cents deviation from target string:**

```ts
// targetMidi for string i = STANDARD_BASE_NOTES[n][i] + offsets[i]   (see SongIndex.ts)
// targetFreq = 440 * 2^((targetMidi - 69) / 12)
// detectedCents = 1200 * log2(detectedFreq / targetFreq)
function centDeviation(detectedFreq: number, targetMidi: number): number {
    const targetFreq = 440 * Math.pow(2, (targetMidi - 69) / 12);
    return 1200 * Math.log2(detectedFreq / targetFreq);
}
```

`STANDARD_BASE_NOTES` needs to be exported from `SongIndex.ts` (currently unexported) or duplicated as a small constant in `TunerScreen.ts`. Export is cleaner.

**Octave error handling:** autocorrelation can lock onto an octave harmonic (e.g. detect 164 Hz when low E is 82 Hz). After computing `detectedCents`, also check `detectedCents - 1200` (one octave down) and `detectedCents + 1200` (one octave up); take the value closest to 0. A detected fundamental 12 semitones off is almost certainly an octave error.

**Audio input dropdown population:**

```ts
const devices = await navigator.mediaDevices.enumerateDevices();
const inputs = devices.filter(d => d.kind === 'audioinput');
// Populate <select>; on change, call detector.destroy() then PitchDetector.create(newDeviceId)
```

`getUserMedia` must be called before `enumerateDevices` returns device labels (browser security); the initial `PitchDetector.create()` call satisfies this — labels will be populated on first open.

**TunerScreen `rAF` loop integration:**

```ts
// Called each frame (requestAnimationFrame)
private tick(): void {
    const result = this.detector?.detect() ?? null;
    const detectedCents = result ? centDeviation(result.frequency, this.targetMidi(this.currentString)) : null;
    this.updateStateMachine(detectedCents);
    this.drawCanvas(detectedCents);
    this.rafId = requestAnimationFrame(() => this.tick());
}
```

`PitchDetector.create()` is async — call it in `mount()` and store the promise. Until it resolves, `this.detector` is null and `detect()` returns null (handled gracefully by the stubbed flow from Step A). Show a "Waiting for mic access…" indicator on the canvas until detector is ready.

---

#### Session state and settings wiring

`App.lastTuningKey` is updated by `TunerScreen.exit()` before navigating to the destination:

```ts
private exit(): void {
    this.app.lastTuningKey = JSON.stringify(this.currentOffsets);
    this.detector?.destroy();
    cancelAnimationFrame(this.rafId);
    // navigate based on this.context
}
```

`tunerAutoAdvance` setting: read from `Settings` in `TunerScreen.mount()`; controls whether `complete` state auto-exits after 1 s or shows a button.

**Mid-song entry:** `ActiveSceneScreen` pauses the song, records `pausedAt`, then calls:
```ts
app.navigate(new TunerScreen(app, 'mid-song', entry, part, library, pausedAt));
```
`TunerScreen` stores `pausedAt` and passes it to `app.resumeWithCountdown(pausedAt)` on exit.

---

#### Keys / drums

Keys and drums skip the tuner entirely — `shouldAutoTune()` returns false for non-stringed instruments and `PreSceneScreen` navigates straight to `ActiveSceneScreen`. No `TunerScreen` is shown.

A MIDI input-check screen (device list → "hit something" tile visualiser) is a possible future addition but is not planned for Phase 6.5.

---

**Session state:** `App.lastTuningKey: string | null` — stringified `StringSemitoneOffsets` of last tuned instrument. Updated on any tuner exit (complete or skip). Auto-tuner fires when `null` or tuning changed; does not re-fire for same tuning even after a skip.

**Three entry contexts — different exit destinations:**
- **song-flow** (pre-scene "Tune" button, or auto from Play) → Active Scene (start song). Pre-scene "Tune" button no longer returns to pre-scene; tuning is the last step before playing.
- **mid-song** (settings "Tune" during active scene) → 3-2-1 countdown → resume.
- **menu** (settings "Tune" from Library or Pre-scene) → return to previous screen. Exit button label: "Main Menu".

**Auto-advance** (default on): ✓ "In tune!" fades → 1 second → proceeds automatically. `tunerAutoAdvance` setting (in Settings panel) disables this — shows context-appropriate button ("Play Song" / "Resume Song" / "Main Menu") and waits for press.

---

#### Known issues / follow-up (from first live test)

**Sustained note detection fails for some strings (e.g. A2):** ✅ Fixed
Switched from raw autocorrelation (with `r[minLag]` as clarity reference) to full NSDF (McLeod Pitch Method). Denominator is now `m[lag] = Σ(x[i]² + x[i+lag]²)`, computed incrementally. nsdf ∈ [−1,1] — amplitude-independent and robust to harmonic-heavy sustained signals.

**Gain slider range needs extending:** ✅ Fixed
Extended to 1×–24×.

**Tuner canvas too small / blurry on high-DPI screens:** ✅ Fixed
Canvas buffer now scaled by `devicePixelRatio`; ctx pre-scaled so all drawing coordinates remain in CSS-pixel space. Canvas height set to 270px.

**Validation phase causing infinite correction loop:** ✅ Fixed
Removed instant kick-back on `cents > 30¢` (fired on any adjacent-string bleed during a strum). Replaced with a 5-second timeout per validation string — only retries correction if the string genuinely fails for an extended period.

**Dwell times too long:** ✅ Fixed
Correction: 500ms → 250ms. Validation: 300ms → 120ms.

**Auto-boost for weak-signal strings (e.g. high e):** ✅ Added
If `lastRms > 0.02` (signal present) but no pitch detected for 2 consecutive seconds in correction phase, gain is silently doubled (capped at 24×). Restored on string advance and restart.

---

### Phase 6.6 — Active scene overlay ✅

HTML overlay on top of the Three.js canvas. Auto-hides after 3 seconds of inactivity while playing; always visible while paused or on mouse movement.

**Top bar layout** (left→right):
```
[← Library] [▶/⏸] [0:23] [────●──────────────────────] [3:45] [−][0.8×▾][+]   ⚙
```
- Back button, play/pause, current time, seek bar, total duration, speed control, gear button (separate fixed element)
- Bar right-padding leaves 54px gap so content never overlaps the ⚙ button
- Bottom-of-screen gradient removed — top bar + gradient fading downward from bar

**Seek bar + section tick marks:**
- `<input type="range">` with section markers overlaid as absolute-positioned divs
- Uses `instrumentNotes.Sections` first; falls back to `songStructure.Sections`
- Tick marks carry the section name as `title` for native browser tooltip
- Scrubbing: `pointerdown` pauses, `input` updates scene in real-time, `pointerup` triggers resume-with-countdown

**Resume-with-countdown (play button + seek release):**
All manual resumes use the same 3-2-1 path as settings close:
1. `app.resumeWithCountdown(pausedAt)` — new public method on `App`; computes `resumeAt = max(0, pausedAt - 3)`
2. `onSongRollback(resumeAt)` fires immediately → starts scroll-back animation + marks grace period
3. 3-second countdown overlay, then `onSongResume(resumeAt)` → audio play

**Scroll-back animation:**
- `onSongRollback` captures current scene position, seeks audio player to `resumeAt`, stores from/to/startMs
- `onPreDraw` drives `scene.currentSecond` with ease-out cubic over 0.8s back to `resumeAt`
- After animation completes, `onPreDraw` reverts to driving from `songPlayer.currentSecond` as normal

**Grace period (notes in the 3-second lead-in):**
- `FretPlayerScene3D.gracePeriodEndTime: number | null` — set to the originally-seeked position
- Notes with `TimeOffset < gracePeriodEndTime` are drawn with `_isGraceDraw = true`: 55% desaturation toward grey, 40% normal alpha, chord outlines at 25% alpha
- Grace notes are NOT scored (skipped in `evaluateMockDetection`; same guard applies to real detection later)
- Auto-clears in `drawQuads` when `currentTime >= gracePeriodEndTime`

**Playback speed:**
- `ISongPlayer` interface extracted from `SongPlayer` — `ActiveSceneScreen` types its field as `ISongPlayer`
- `SongPlayer` implements `ISongPlayer.playbackRate` via `AudioBufferSourceNode.playbackRate` (Option A — pitch shifts proportionally at non-1× speeds)
- `playbackRate` setter re-anchors `pausedAt` and `startContextTime` before changing rate, preventing `currentSecond` jumps mid-playback
- `currentSecond` getter: `pausedAt + (context.currentTime - startContextTime) * playbackRate`
- A future `TimestretcSongPlayer` implementing `ISongPlayer` (SoundTouch WASM, no pitch shift) can drop in with zero changes to `ActiveSceneScreen`

**Speed compound control — `[−] [select▾] [+]`:**
- Visually a single bordered unit (border wraps all three elements)
- Dropdown preset options: multiples of 0.2 (0.2×–2.0×, 10 options)
- ±0.05 fine-step buttons: range 0.05×–2.00×
- When ±buttons land on a non-preset value, a dynamic `customOpt` element is inserted at the top of the `<select>` and selected — the collapsed dropdown always shows the exact current speed
- Custom option is removed and preset option is selected when returning to a 0.2-multiple

**Deferred (document here for future reference):**
- Waveform on seek bar — compute peak array from `AudioBuffer` after load
- Pitch shift — WASM dependency (SoundTouch.js); same work as proper time-stretch
- Loop markers — set start/end points for section repeat (part of practice mode stretch goal)
- Vocal display — lyric lines from `SongVocals`
- Play stats / tags / favorites

---

### Stretch Goal — Practice mode

Accessible via the settings panel when in the active scene. Intended as a long-term addition, not Phase 6.

- Playback speed slider (0.5×–1.0×, requires WASM time-stretcher)
- Loop markers: drag start/end handles on the seek bar to repeat a section
- Per-section repeat: jump back automatically when a section ends
- Note detection feedback (requires Stretch Goal B — NoteDetector)

---

**Deliverable:** A complete, navigable application. Load a song folder, pick an instrument, tune up, watch it play.

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

**Prior art:** `NoteDetector.cs` in `ChartPlayerShared/` is fully implemented. Key findings from analysis:
- Uses two detectors in parallel: autocorrelation (4096-sample FFT) + spectral peak finder (8192-sample FFT). The spectral path is for chords; for single notes the autocorrelation path suffices.
- **No onset detection** — polls every 50ms: "is this frequency currently present?" If yes when the note is at the now-line, it's a hit. No timing window arithmetic.
- **Tolerance: 0.5 semitones (~50¢)** — much more lenient than the tuner (±10–15¢). Live play, not tuning.
- **Binary hit/miss** per note — no early/late grading.
- Chord detection: all expected frequencies must be simultaneously present. Deferred — single notes only for now.

**JS library landscape (evaluated):**
- `aubio.js` — WASM port of mature C library; has pitch + onset detection. Most relevant if chords or onset timing are ever needed.
- `Pitchfinder` — pure JS, several algorithms; no onset detection. Lightweight.
- `ml5.js PitchDetection` — wraps CREPE (ML model); impressive real-instrument accuracy; heavier.
- `essentia.js` — WASM, very comprehensive; overkill for current scope.
- **Decision: no external library.** Our existing NSDF `PitchDetector` is sufficient for single-note polling. The C# didn't do anything we can't replicate.

---

#### Architecture

**Files to write:**
- `ThreeCP/Project/src/NoteDetector.ts` — note matching class; owns hit/miss state; writes into the scene's existing `notesDetected` array

**Files to modify:**
- `ThreeCP/Project/src/PitchDetector.ts` — expose `ctx.currentTime` so hit timing uses the audio clock
- `ThreeCP/Project/src/ActiveSceneScreen.ts` — create `NoteDetector`, optionally reuse `PitchDetector` from tuner exit
- `ThreeCP/Project/src/TunerScreen.ts` — pass detector instance to `ActiveSceneScreen` on `song-flow` exit instead of destroying it

**No changes needed to `FretPlayerScene3D`** — `notesDetected: Int8Array` and `noteIndexMap: Map<SongNote, number>` are already in place, written by mock detection today; real detection writes to the same arrays.

---

#### `NoteDetector.ts` — design

Constructor inputs:
- `instrumentNotes: SongInstrumentNotes`
- `part: SongIndexPart` (for `tuningOffsets`)
- `currentSecond: () => number` — getter into `SongPlayer.currentSecond`
- `notesDetected: Int8Array` — shared with scene; values: `0` = unscored, `1` = hit, `-1` = miss
- `noteIndexMap: Map<SongNote, number>` — maps note → index in `notesDetected`

Per-tick method `tick(result: PitchResult | null)` — called from `ActiveSceneScreen`'s rAF loop:

**Job A — miss sweep (every tick, regardless of detection):**
Walk notes near `currentSecond`. Any note with `TimeOffset + MISS_WINDOW_SECS` elapsed and `notesDetected[i] === 0` → mark `-1`. `MISS_WINDOW_SECS ≈ 0.15`.

**Job B — hit matching (every tick, not gated on onset):**
Mirrors the C# polling approach. If `result !== null` (pitch detected):
1. Find candidate notes: `TimeOffset` within `±HIT_WINDOW_SECS` of `currentSecond`. `HIT_WINDOW_SECS ≈ 0.15`.
2. For each candidate with `notesDetected[i] === 0`: compute expected MIDI = `BASE_NOTES[n][stringIndex] + tuningOffset[stringIndex] + note.FretNumber`. Compare to detected frequency via `centDeviationWithOctaveCorrection`.
3. If within `±50¢`, mark hit (`1`). If multiple candidates qualify, take the closest `TimeOffset` to `currentSecond`.

**Chord handling (single-note mode):**
Chord notes each have their own entry in `noteIndexMap`. A chord is considered hit if any one of its constituent notes is matched. First-correct-string wins; remaining chord notes stay unscored (not penalised).

**Grace period guard:**
Skip scoring for notes with `TimeOffset < scene.gracePeriodEndTime` — these notes are already rendered as desaturated grace notes and must not be scored.

**Note pitch lookup** — same formula as tuner's `computeTargetMidis`:
```ts
const midi = STANDARD_BASE_NOTES[n][stringIndex] + (tuningOffsets[stringIndex] ?? 0) + note.FretNumber;
```

---

#### Tuner → active scene handoff

When the tuner exits via `song-flow`, instead of calling `detector.destroy()`, pass the live `PitchDetector` instance to `ActiveSceneScreen`. This avoids a second `getUserMedia` prompt and removes the ~100ms gap while a new `AudioContext` is created.

If the user skipped the tuner (went straight to Play), `ActiveSceneScreen` creates its own `PitchDetector` lazily — same async pattern as the tuner's `startDetector()`. If mic access is denied, `NoteDetector` receives `null` every tick and never scores anything; the scene runs in unscored mode silently.

---

#### Deferred / stretch

- **Onset detection** — would enable timing grades (early/late/perfect). Not in C# original; add if desired later. `aubio.js` is the path.
- **Chord detection** — requires the spectral peak detector path (8192-sample FFT, multi-peak). Hard with a mic; tractable with a direct-in guitar signal.
- **SampleHistory ring buffer / AudioWorklet** — only needed if we move pitch detection off the main thread. Not required for current polling approach.

---

## Known UX issues (deferred)

- **Single-note hit feedback unclear** — The `GuitarDetected` overlay appears on the note head and the note colour brightens on hit, but single (non-sustained) notes pass the now-line too quickly for this to be visually obvious. Long notes with trails are clear; single notes are not. Attempts to add a larger overlay or string-line flash made sustained notes worse without improving single notes. Needs a dedicated approach — likely a brief timed flash or particle effect anchored at the now-face that persists for ~100–200ms after the hit, independent of note length.

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
| Stretch B | `NoteDetector` | Guitar single-note scoring via microphone |
