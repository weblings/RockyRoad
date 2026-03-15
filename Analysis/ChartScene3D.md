# ChartScene3D.cs — Conversion Analysis

**Source:** `ChartPlayerShared/ChartScene3D.cs`
**Inherits:** `Scene3D`
**Subclassed by:** `FretPlayerScene3D`, `DrumPlayerScene3D`, `KeysPlayerScene3D`
**Role:** Intermediate rendering base. Adds time tracking, beat drawing, and note-window search utilities on top of the raw quad-batch renderer.

---

## What it adds over Scene3D

| Addition | Purpose |
|---|---|
| `currentTime`, `startTime`, `endTime` | Playback position and visible time window |
| `timeScale` | Converts seconds → world-space Z units |
| `NoteDisplaySeconds` / `NoteDisplayDistance` | Config for how far ahead to show notes |
| `GetStartNote` / `GetEndNote` | Windowed iteration over note lists |
| `DrawBeats()` | Renders beat/measure grid lines |
| `UpdateCamera()` | Virtual hook for subclass camera positioning |
| `IMidiHandler` interface | Drum MIDI input contract |
| `LeftyMode` | Delegates to `Camera.MirrorLeftRight` |

---

## The critical time → Z coordinate formula

Every draw call that places something at a point in time uses:
```cs
float z = time * -timeScale;
```

`timeScale = NoteDisplayDistance / NoteDisplaySeconds` (computed in `Draw()`).

At default values: `600 / 3 = 200 units/second`.

The **negative sign** is load-bearing. In the original XNA left-handed system, positive Z goes into the screen (away from camera). Negating time pushes past notes toward positive Z (behind camera) and future notes toward negative Z (in front of camera). In Three.js's right-handed system, positive Z comes toward the camera, so the negation still correctly places future notes in front and past notes behind — the convention survives the coordinate flip.

**Summary: `z = time * -timeScale` ports unchanged.**

---

## Note window search: GetStartNote / GetEndNote

These are linear-scan helpers with a position hint (`startNotePosition`) that persists across frames, making them effectively O(1) in steady state. They work on any `IList<T>` where `T : ISongEvent` (which exposes `TimeOffset` and `EndTime`).

Ports directly to generic TS functions — no framework dependency.

```ts
// Equivalent TS signature:
function getStartNote<T extends ISongEvent>(
  timeOffset: number, minLength: number, startPos: number, notes: T[]
): number
```

---

## DrawBeats

Reads `player.SongStructure.Beats` (a list of `SongBeat` with `TimeOffset` and `IsMeasure`).

Draws horizontal quad lines across `highwayStartX` to `highwayEndX` at the Z position of each beat. Measures are slightly brighter/thicker than beats.

Also computes `CurrentBPM` from the delta between the first two visible beats.

Ports directly — just calls `DrawHorizontalLine` which in turn calls `DrawQuad`.

---

## Virtual method pattern

```
Draw()
  └── UpdateCamera()     ← subclass positions the camera
  └── base.Draw()
        └── DrawQuads()  ← subclass submits geometry
              └── DrawBeats()
```

`UpdateCamera()` is called before the base `Draw()` so camera matrices are correct before any geometry is submitted. This ordering must be preserved in the TS port.

---

## IMidiHandler

```cs
interface IMidiHandler {
    void HandleNoteOn(int channel, int noteNumber, float velocity, int sampleOffset);
    void HandlePolyPressure(int channel, int noteNumber, float pressure, int sampleOffset);
}
```

Only `DrumPlayerScene3D` implements this. In the browser, these callbacks are triggered by the **Web MIDI API** (`MIDIMessageEvent`) instead of a DAW plugin callback. The method signatures map cleanly, though `sampleOffset` (sample-accurate timing from the DAW) has no Web MIDI equivalent — it becomes 0 or is replaced by `event.timeStamp`.

---

## LeftyMode

Delegates directly to `Camera.MirrorLeftRight`. No logic here beyond that.

---

## Output file
`ThreeCP/ChartScene3D.ts`
