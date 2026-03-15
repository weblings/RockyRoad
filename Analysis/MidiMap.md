# MidiMap.cs — Conversion Analysis

**Source:** `ChartPlayerShared/MidiMap.cs`
**Contains:** `DrumVoice`, `DrumHit`, `DrumMidiMapEntry`, `DrumMidiDeviceConfiguration`

---

## What it does

Maps MIDI note numbers to drum kit pieces and articulations. Also handles hi-hat pedal state and snare position sensing from MIDI controller channels.

---

## Data structures

### DrumVoice (struct → TS interface)
```cs
struct DrumVoice {
    EDrumKitPiece KitPiece;
    EDrumArticulation Articulation;
}
```
A drum pad identity. Ports as a simple TS interface. The static methods on `DrumVoice` (`GetKitPieceType`, `GetDefaultArticulation`, `GetValidArticulations`, etc.) port as standalone utility functions or a namespace.

### DrumHit (struct → TS interface)
```cs
struct DrumHit {
    DrumVoice Voice;
    float Velocity;    // 0–1
    bool IsLive;       // true = triggered by player, false = from song data
    float DimensionValue; // hi-hat pedal position or snare position
}
```
Represents a single drum strike event. Ports cleanly.

### DrumMidiDeviceConfiguration
A mapping table from MIDI note number → `DrumVoice`, plus:
- Hi-hat pedal calibration (closed/semi-open/open thresholds)
- Snare position sensing (center vs. edge)
- XML serialization for save/load

---

## MIDI source: DAW → Web MIDI API

**C# source:** DAW plugin receives MIDI from the drum kit and calls `HandleNoteOn` / `HandlePolyPressure` on whatever implements `IMidiHandler`.

**Browser source:** Web MIDI API.
```ts
navigator.requestMIDIAccess().then(midi => {
    for (const input of midi.inputs.values()) {
        input.onmidimessage = (event) => {
            const [status, note, velocity] = event.data;
            const command = status & 0xF0;
            const channel = status & 0x0F;

            if (command === 0x90 && velocity > 0) {
                handleNoteOn(channel, note, velocity / 127);
            } else if (command === 0xA0) {
                handlePolyPressure(channel, note, velocity / 127);
            }
        };
    }
});
```

MIDI channel 10 (index 9) is the conventional drum channel, but the C# code routes by note number rather than channel, which is more robust.

---

## Hi-hat pedal channel

```cs
public int HiHatPedalChannel { get; set; } = 4; // CC channel 4
```
In MIDI, a hi-hat pedal sends **Control Change** messages (`0xB0`), not note-on. The C# code watches a specific CC channel. In the browser:
```ts
if (command === 0xB0 && channel === hiHatPedalChannel) {
    config.setHiHatPedalValue(value / 127);
}
```

---

## Config persistence: XML → JSON

Currently serialized to/from XML files. In the browser, replace with `JSON.stringify` / `JSON.parse` stored in `localStorage` or a user-downloadable file.

```ts
// Save
localStorage.setItem('drumMidiMap', JSON.stringify(config));

// Load
const config = JSON.parse(localStorage.getItem('drumMidiMap') ?? '{}');
```

---

## Enums

`EDrumKitPiece`, `EDrumArticulation`, `EDrumKitPieceType` are defined in `SongFormat` (a separate project). They need to be sourced from the SongFormat data types when porting. Port as TS enums.

---

## Generic drum map (default)
The static `Generic()` method defines a standard GM drum mapping (MIDI note 36 = kick, 38 = snare, etc.). This is pure data and ports directly.

---

## What to port

| Item | Action |
|---|---|
| `DrumVoice` | Port as TS interface |
| `DrumHit` | Port as TS interface |
| `DrumMidiDeviceConfiguration` | Port — replace XML with JSON, DAW MIDI with Web MIDI API |
| `EDrumKitPiece`, `EDrumArticulation` | Port as TS enums (sourced from SongFormat) |
| Hi-hat + snare controller channels | Port — same logic, different MIDI event source |

---

## Output files
- `ThreeCP/MidiMap.ts`
