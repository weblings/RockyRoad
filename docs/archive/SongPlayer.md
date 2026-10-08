# SongPlayer.cs + SongPlayerSettings.cs — Conversion Analysis

**Sources:** `ChartPlayerShared/SongPlayer.cs`, `ChartPlayerShared/SongPlayerSettings.cs`

---

## SongPlayer

### What the rendering pipeline needs from it

The player scenes only read **one property**:
```cs
float currentTime = (float)player.CurrentSecond;
```

Everything else in `SongPlayer` is audio pipeline. From the rendering perspective, `SongPlayer` is a black box that produces a `CurrentSecond` value.

### What it does

| Responsibility | Implementation |
|---|---|
| Vorbis decoding | `VorbisMixer` (custom) |
| Sample rate conversion | `WdlResampler` (Cockos WDL port) |
| Time-stretching / pitch-shifting | RubberBand (native library via P/Invoke) |
| Background decode | `Thread.Start()` → decodes entire song upfront into `sampleData[2][]` |
| Dynamic gain normalization | Per-bin RMS → smooth gain target |
| `ReadSamples(left, right)` | Called by audio callback thread each buffer period |
| `CurrentSecond` | Derived from `currentPlaybackSample / totalSamples * SongLengthSeconds` |

### Browser equivalent

| C# | Browser |
|---|---|
| `VorbisMixer` (Vorbis decoder) | `fetch` + `AudioContext.decodeAudioData()` (browser supports Ogg Vorbis in most engines) |
| `WdlResampler` | Not needed — `AudioContext` handles sample rate conversion |
| `RubberBand` (time-stretch) | No direct equivalent — options: `soundtouch.js` (WASM), or omit for now |
| Background decode thread | `async/await` + `AudioContext.decodeAudioData()` (already async) |
| `ReadSamples` audio callback | `AudioWorkletProcessor` (replaces deprecated `ScriptProcessorNode`) |
| `CurrentSecond` | `audioContext.currentTime` offset by playback start time, or `AudioBufferSourceNode` position |

### Key design difference: eager vs. streaming decode

The C# version decodes the **entire song into RAM upfront** (`sampleData[0/1]` arrays). For a browser port at typical song lengths (~4–6 min × 48kHz × 2 channels × 4 bytes), that's ~110–165 MB per song — feasible but large.

Alternative: `AudioBufferSourceNode.start(when, offset)` lets the browser handle decoding and playback natively with no manual buffering. `CurrentSecond` then tracks `audioContext.currentTime - startTime`.

### `Loudness[]` array
Pre-computed 512-bin RMS envelope of the song. Used only for gain normalization in `ReadSamples`. In the browser, if native playback handles gain, this can be omitted initially.

### Seeking
```cs
public void SeekTime(float secs) { seekTime = secs; CurrentSecond = seekTime; }
```
Maps to `AudioBufferSourceNode.stop()` + create new source node at new offset, or keep a running offset variable.

### Pitch shifting / tuning modes
`ESongTuningMode` enum adjusts playback pitch to match alternate guitar tunings or songs recorded off A440. In the browser: `AudioWorklet` with RubberBand WASM, or skip for initial port.

---

## SongPlayerSettings

A clean POJO with no framework dependencies. Ports directly.

```ts
interface SongPlayerSettings {
    songPath: string;
    invertStrings: boolean;
    leftyMode: boolean;
    mutePartStems: boolean;
    songTuningMode: ESongTuningMode;
    bassUsingGuitar: boolean;
    noteDisplaySeconds: number;
    drumsNoteDisplaySeconds: number;
    keysNoteDisplaySeconds: number;
    currentInstrument: ESongInstrumentType;
    songListSortColumn: string;
    songListSortReversed: boolean;
    uiScale: number;
    drumMidiMapName: string;
}
```

`ESongTuningMode` ports as a TS `enum` or `const` object.

### SongPlayerSettingsInterface
The settings dialog UI. Pure MonoGame UI with reflection-based property binding (`PropertyInfo.SetValue/GetValue`). This entire class is dropped and replaced with HTML form elements in the browser.

---

## What to port

| Item | Action |
|---|---|
| `SongPlayer` (full audio engine) | Replace with `AudioContext`-based player |
| `CurrentSecond` | Derive from `audioContext.currentTime` |
| `SongPlayerSettings` POJO | Port 1:1 as TS interface + localStorage for persistence |
| `ESongTuningMode` enum | Port as TS enum |
| `SongPlayerSettingsInterface` | Drop — replace with HTML UI |
| `VorbisMixer`, `WdlResampler` | Drop — browser handles decoding natively |
| `RubberBandStretcherStereo` | Drop for initial port; revisit for speed/pitch features |

---

## Output files
- `ThreeCP/SongPlayer.ts` (thin wrapper around AudioContext)
- `ThreeCP/SongPlayerSettings.ts` (POJO interface + localStorage)
