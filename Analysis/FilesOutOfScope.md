# Files Out of Scope — Conversion Notes

Files in `ChartPlayerShared/` that are **not ported** and why.

---

## Drop entirely (DAW plugin / desktop-only)

| File | Reason |
|---|---|
| `ChartPlayerPlugin.cs` | DAW plugin wrapper (VST/AU). No browser equivalent. Plugin functionality (fullscreen, window mgmt) replaced by browser APIs. |
| `VorbisMixer.cs` | Vorbis audio decoding. Browser's `AudioContext.decodeAudioData()` handles Ogg/Vorbis natively. |
| `WdlResampler.cs` | Cockos WDL sample rate converter. Not needed — `AudioContext` handles resampling. |
| `DrumUIMapping.cs` | Maps drum MIDI hits to UI navigation actions (e.g. Tom1 = PageUp). This is a DAW-specific input routing concept; browser keyboard/gamepad events serve this role instead. |

---

## Replace with HTML/CSS (UI layer)

| File | Browser replacement |
|---|---|
| `SongPlayerInterface.cs` | Root UI container → top-level HTML `<div>` layout |
| `SongListInterface.cs` | Song browser → `<ul>` / virtualized list component |
| `HelpDialog.cs` | Help screen → `<dialog>` or modal `<div>` |
| `MidiMapInterface.cs` | MIDI config UI → HTML form with Web MIDI device selector |
| `TunerInterface.cs` | Tuner display → HTML canvas or SVG gauge |
| `LevelDisplay.cs` | RMS level meter → HTML `<meter>` or canvas bar |
| `VocalDisplay.cs` | Vocal karaoke display → HTML overlay on the 3D canvas |
| `SongPlayerSettingsInterface` (in SongPlayerSettings.cs) | Settings dialog → HTML form |

---

## Defer (scoring / audio input)

| File | Notes |
|---|---|
| `NoteDetector.cs` | FFT pitch detection from audio input. No browser input source without mic. Needed only for scoring. |
| `SampleHistory.cs` | Ring buffer feeding NoteDetector. Only needed alongside NoteDetector. |

---

## Already analyzed / in scope

| File | Analysis file |
|---|---|
| `Camera3D.cs` | `Analysis/Camera3D.md` |
| `ChartPlayerGame.cs` | `Analysis/ChartPlayerGame.md` |
| `Scene3D.cs` + `QuadBatch.cs` | `Analysis/Scene3D.md` |
| `ChartScene3D.cs` | `Analysis/ChartScene3D.md` |
| `FretPlayerScene3D.cs` | `Analysis/PlayerScenes.md` |
| `DrumPlayerScene3D.cs` | `Analysis/PlayerScenes.md` |
| `KeysPlayerScene3D.cs` | `Analysis/PlayerScenes.md` |
| `SongPlayer.cs` + `SongPlayerSettings.cs` | `Analysis/SongPlayer.md` |
| `NoteUtil.cs` | `Analysis/NoteDetector.md` |
| `MidiMap.cs` | `Analysis/MidiMap.md` |

---

## SongIndex.cs

Song library scanner/indexer that walks the filesystem for song folders. In the browser, this becomes a server-side API or a local file picker (`<input type="file" webkitdirectory>`). Worth a separate analysis pass if implementing the song browser.
