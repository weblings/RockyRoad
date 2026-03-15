# NoteDetector.cs + NoteUtil.cs + SampleHistory.cs — Conversion Analysis

**Sources:**
- `ChartPlayerShared/NoteDetector.cs`
- `ChartPlayerShared/NoteUtil.cs`
- `ChartPlayerShared/SampleHistory.cs`

---

## NoteDetector

### What it does

Real-time FFT-based pitch detection from a live audio input (the guitar signal coming through the DAW). Runs on a background thread at ~50ms intervals.

Two FFT sizes are used:
- `CorrFFTSize = 4096` — autocorrelation-based pitch detection (`PitchDetector.GetPitchPeaks`)
- `SpecFFTSize = 8192` — spectrum analysis (`PitchDetector.GetSpectrum`)

Outputs:
- `CurrentPitch` — the dominant detected frequency in Hz
- `NoteDetect(freq)` — returns true if a given frequency (with octave tolerance) is present in the spectrum
- `NoteDetect(frequencies[], numFreqs)` — chord detection: all given frequencies must be present as spectral peaks

### DAW plugin coupling

**Tightly coupled to the DAW plugin:**
```cs
// Reads sample rate from the DAW host:
double GetBin(double frequency) =>
    fftData.Length * (frequency / ChartPlayerGame.Instance.Plugin.Host.SampleRate);

// Reads audio samples from the DAW:
SampleHistory<float> history = ChartPlayerGame.Instance.Plugin.SampleHistory;
history.Process(copyDelegate, Math.Max(SpecFFTSize, CorrFFTSize));
```

In the browser there is **no DAW plugin**. The input source would be the microphone via `getUserMedia`.

### Browser equivalent

| C# | Browser |
|---|---|
| DAW plugin audio input | `navigator.mediaDevices.getUserMedia({ audio: true })` |
| `SampleHistory` filled by DAW callback | `AudioWorkletProcessor` filling a `SharedArrayBuffer` ring buffer |
| Background `Thread` running `UpdateFFT()` every 50ms | Web Worker reading from the SharedArrayBuffer |
| `PitchDetector` (native C++ via P/Invoke) | `pitchfinder` npm package, or custom autocorrelation in JS/WASM |
| `spectrumDetector.GetSpectrum` | `AnalyserNode.getFloatFrequencyData()` |

### For a browser viewer (no input scoring)
If the goal is purely **visualization** (displaying the chart without detecting what the user plays), `NoteDetector` is entirely omitted. `isDetected` / `notesDetected[]` state stays false/null and notes simply display without hit detection.

---

## NoteUtil

Pure music theory utilities. **Zero framework dependencies.** Ports 1:1.

```ts
// Direct ports:
function getMidiNoteFrequency(midiNoteNum: number): number
function getNoteName(midiNoteNum: number): ENoteName
function getNoteOctave(midiNoteNum: number): number
function getMidiNoteNumber(note: ENoteName, octave: number): number
function getSemitoneDifference(freq1: number, freq2: number): number
function tryParseNoteName(noteStr: string): { note: ENoteName, octave: number } | null
```

Key constants:
- `A4Frequency = 440.0`
- `A4MidiNoteNum = 57` (MIDI note 57 = A4 in standard MIDI numbering)
- `HalfStepRatio = 2^(1/12)`

The `ENoteName` enum and `EChordType` enum port directly. `Scales` (major/minor scale intervals) are also pure data.

---

## SampleHistory<T>

A **circular ring buffer** for audio samples.

```
[ ... | ... | ... | ... ]
               ^
               CurrentOffset (write cursor)
```

`CopyFrom(source)` — writes incoming samples into the ring, wrapping around.

`Process(delegate, numSamples)` — reads the most recent `numSamples` samples from before the write cursor and calls the delegate, handling wrap-around in two passes if needed.

Used to bridge the real-time audio callback thread → NoteDetector thread safely (though notably there's no mutex — relies on the ring buffer being large enough that reads and writes don't collide).

### Browser equivalent

`SharedArrayBuffer` + `Atomics` is the browser-native equivalent for sharing audio data between an `AudioWorkletProcessor` (writer) and a Web Worker (reader). Or a simpler JS ring buffer class if staying single-threaded.

For display-only use, `SampleHistory` is not needed at all.

---

## What to port

| Item | Action |
|---|---|
| `NoteUtil` | Port 1:1 — no dependencies |
| `ENoteName`, `EChordType` | Port as TS enums |
| `NoteDetector` | Omit for initial display-only port; revisit for scoring |
| `SampleHistory<T>` | Omit for initial port; revisit if scoring is added |

---

## Output files
- `ThreeCP/NoteUtil.ts` — port now (pure logic)
- `ThreeCP/NoteDetector.ts` — defer
- `ThreeCP/SampleHistory.ts` — defer
