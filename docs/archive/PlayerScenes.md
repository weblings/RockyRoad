# Player Scenes — Conversion Analysis

**Sources:**
- `ChartPlayerShared/FretPlayerScene3D.cs` (+ `FretCamera`)
- `ChartPlayerShared/DrumPlayerScene3D.cs`
- `ChartPlayerShared/KeysPlayerScene3D.cs`

All three follow the same pattern: extend `ChartScene3D`, override `UpdateCamera()` and `DrawQuads()`.

---

## Shared patterns across all three

### World-space layout convention
All scenes lay the highway flat on the **XZ plane** at Y=0:
- **X axis** — lateral position (fret number, lane, or piano key)
- **Y axis** — height (camera is elevated above the highway)
- **Z axis** — time (future notes at negative Z, current time at Z=0, past at positive Z via `time * -timeScale`)

### Camera update formula
All three do: set `Camera.Position`, then call `Camera.SetLookAt(target)`. The camera sits above and behind the current play position, looking slightly down-forward along the highway.

### Draw primitive vocabulary
Five drawing helpers appear across all three scenes:

| Method | Quad orientation | Use |
|---|---|---|
| `DrawHorizontalLine` / `DrawLaneHorizontalLine` | Flat on XZ plane | Beat lines, hit zone |
| `DrawKeyTimeLine` / `DrawLaneTimeLine` | Flat on XZ plane, narrow strip | Lane dividers |
| `DrawVerticalImage` | Flat on XY plane (facing camera Z) | Notes, note faces |
| `DrawFlatImage` | Flat on XZ plane | Note trails, key trails |
| `DrawCameraAlignedImage` | Billboard (faces camera using Right/Up) | Drum cymbal/head images |

All of these ultimately call `DrawQuad` with four `Vector3` corners. The conversion strategy is the same for all: compute the same corner positions in TS using `THREE.Vector3` arithmetic, then write to the `Float32Array` buffers.

---

## FretPlayerScene3D + FretCamera

### FretCamera (subclass of Camera3D)
Smooth-tracking camera that lerps toward the active fret range. Per-frame update:
1. Computes `targetCameraDistance` from the span of active frets
2. Lerps `CameraDistance` (1% per frame) and `positionFret` (2% per frame) toward targets
3. Adds a horizontal offset (`fretOffset`) so the camera is slightly to the high-string side
4. Sets position and calls `SetLookAt`

These lerps are **frame-rate dependent** as written (they assume 60fps). In the browser port, lerp speed should be scaled by `dt` (delta time in seconds).

### GetFretPosition
Converts fret number (0–24) to world X coordinate. Need to read the full implementation (file was truncated) but it's referenced as `FretPlayerScene3D.GetFretPosition(fret)` — a static method.

### String colors
```cs
static UIColor[] stringColors = { green, red, yellow, cyan, orange, green, purple };
```
Standard 6-string guitar string colors (E A D G B e + extra for 7-string). Ports as a `THREE.Color[]` constant array.

### NoteDetector integration
`FretPlayerScene3D` constructs a `NoteDetector` and runs it on a background thread. This is the audio pitch-detection system that scores whether the player is hitting the right notes.

- Reads from `ChartPlayerGame.Instance.Plugin.SampleHistory` (DAW audio input buffer)
- In the browser: **no direct equivalent** — would require microphone input via `getUserMedia` + a Web Worker for the FFT loop
- For a browser-only viewer (no input scoring), NoteDetector can be entirely omitted

### DrawCameraAlignedImage (billboarding)
```cs
DrawQuad(image,
    center + (Camera.Right * minX) + (Camera.Up * minY),
    center + (Camera.Right * minX) + (Camera.Up * maxY),
    ...
```
Uses stored `Camera.Right` and `Camera.Up` to build a billboard quad. This is why the `Camera3D` TS port needs to maintain `right` and `up` as explicit properties — they're consumed here at draw time.

In Three.js, an alternative would be `THREE.Sprite`, but since everything uses the QuadBatch, staying in the same quad approach is cleaner.

### Chord/technique system
`FretPlayerScene3D` has significant logic for:
- `nonRepeatChords` / `nonRepeatNotes` dictionaries — track when to re-show chord annotations
- `Techniques` flags (`ESongNoteTechnique.Continued`, bend, vibrato, etc.)
- `currentStringNotes[]` / `currentStringDetected[]` — per-string state

This is game logic that ports directly; no rendering-specific concerns.

---

## DrumPlayerScene3D

### Lane layout
```cs
float GetLanePosition(float lane) => lane * 15;
```
5 lanes, 15 units each → highway is 75 units wide. `highwayStartX = 0`, `highwayEndX = 75`.

### MIDI input
Implements `IMidiHandler`. In the browser, equivalent callbacks come from:
```ts
midiInput.onmidimessage = (event) => {
    // event.data[0] = status byte (note on = 0x99 for channel 10)
    // event.data[1] = note number
    // event.data[2] = velocity
};
```
`HandlePolyPressure` (used for cymbal choke) maps to MIDI aftertouch (`0xA0`).

### Note hit detection
- Stores `notesDetected[pos]` — `null` = unplayed, `float.MaxValue` = missed, `float value` = timing offset in seconds
- Detection window: ±0.1 seconds (`detectionToleranceSecs`)
- Drum note matching goes through `VoicesMatch` which has hi-hat open/closed logic based on `DimensionValue` (pedal position)

### Scale arrays
```cs
static int[]   ScaleWhiteBlack = { 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0 };
static float[] ScaleOffsets    = { 0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6 };
```
These appear in both `DrumPlayerScene3D` and `KeysPlayerScene3D` but aren't used by the drum scene — they appear to be copy-pasted and are actually only active in `KeysPlayerScene3D`. Safe to remove from the drum scene in the TS port.

### Kick drum
Drawn as a full-width horizontal line (`DrawLaneHorizontalLine`) rather than a per-lane image, since kick doesn't have a dedicated lane.

---

## KeysPlayerScene3D

### Piano key position mapping
```cs
static int[]   ScaleWhiteBlack = { 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0 };
static float[] ScaleOffsets    = { 0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6 };

float GetKeyPosition(float key) {
    int octave = ((intKey - minKey) / 12);
    return (ScaleOffsets[(intKey - minKey) % 12] + (octave * 7)) * 8;
}
```
Maps MIDI note number → world X. One octave = 7 white keys = 56 units. Black keys offset by 0.5 key widths. Fractional keys interpolate linearly between adjacent positions.

Ports directly as a TS function.

### Note range: minKey / maxKey
Fixed at MIDI 48 (C3) to 72 (C5) — a 2-octave range. Camera tracks this range similar to how FretCamera tracks fret range.

### Note trails
Uses `DrawFlatImage` to draw horizontal quads from `note.TimeOffset` to `note.TimeOffset + note.TimeLength`, laying the note duration flat on the XZ plane. White keys use `NoteTrailWhite`, black keys use `NoteTrailBlack`.

### No note detection / scoring
`KeysPlayerScene3D` has no scoring system — it just displays notes. No `notesDetected` array, no input handling. Simplest scene to port.

---

## Fog

All three scenes set fog in `DrawQuads()`:
```cs
FogEnabled = true;
FogStart = ...;
FogEnd   = ...;
FogColor = UIColor.Black;
```
Fog fades the highway into black in the distance, hiding the hard edge where note generation stops.

In Three.js: `scene.fog = new THREE.Fog(0x000000, fogStart, fogEnd)`. However, Three.js `Fog` affects all objects in the scene and uses world-space distance from camera, not depth along Z. Since the highway extends along Z and the camera looks down it, world-space distance and Z-depth are approximately equivalent — the difference is only noticeable for objects far off-axis.

For exact matching, a custom shader with manual fog could be written, but `THREE.Fog` is likely close enough.

---

## Output files
- `ThreeCP/FretPlayerScene3D.ts` (+ `FretCamera.ts`)
- `ThreeCP/DrumPlayerScene3D.ts`
- `ThreeCP/KeysPlayerScene3D.ts`
