// Mirrors the SongFormat JSON types used on disk.
// No conversion logic — the JSON files are already the right shape.

export interface ISongEvent {
    TimeOffset: number;
    EndTime?: number; // optional in JSON; treat as TimeOffset when absent
}

export interface SongBeat extends ISongEvent {
    TimeOffset: number;
    IsMeasure?: boolean;
    EndTime?: number;
}

export interface SongSection {
    Name: string;
    StartTime?: number;
    EndTime?: number;
}

export interface SongStructure {
    Sections: SongSection[];
    Beats: SongBeat[];
}

export interface SongTuning {
    StringSemitoneOffsets: number[];
}

export interface SongInstrumentPart {
    InstrumentName: string;
    InstrumentType: string;
    Tuning?: SongTuning;
    CapoFret?: number;
    SongDifficulty?: number;
}

export interface SongInfo {
    SongName: string;
    SongYear?: number;
    SongLengthSeconds: number;
    ArtistName: string;
    AlbumName?: string;
    InstrumentParts: SongInstrumentPart[];
}

// Instrument-specific note data (lead.json, bass.json, etc.)

// ESongNoteTechnique bitmask — matches C# [Flags] enum values exactly.
// Use bitwise AND to test: (note.Techniques & ESongNoteTechnique.Chord) !== 0
export const ESongNoteTechnique = {
    HammerOn:      2,
    PullOff:       4,
    Accent:        8,
    PalmMute:      16,
    FretHandMute:  32,
    Slide:         64,
    Bend:          128,
    Vibrato:       512,
    Harmonic:      1024,
    PinchHarmonic: 2048,
    Chord:         32768,
    ChordNote:     65536,
    Continued:     131072,
} as const;

// Bend data point — time-ordered list stored on SongNote.CentsOffsets
export interface CentsOffset {
    TimeOffset: number;
    Cents: number;
}

export interface SongNote extends ISongEvent {
    TimeOffset: number;
    TimeLength: number;
    EndTime: number;
    Fret: number;
    String: number;
    HandFret: number;
    ChordID?: number;       // index into Chords array; -1 = not a chord
    FingerID?: number;      // index into Chords array for fingering overlay; -1 = none
    SlideFret?: number;     // target fret for Slide notes; -1 = no slide
    Techniques?: number;    // ESongNoteTechnique bitmask
    CentsOffsets?: CentsOffset[] | null;  // bend curve data points
}

export interface SongChordDefinition {
    Name: string;
    Fingers: number[];
    Frets: number[];
}

export interface SongInstrumentNotes {
    Sections: SongSection[];
    Chords: SongChordDefinition[];
    Notes: SongNote[];
}

export interface SongKeyboardNote extends ISongEvent {
    TimeOffset: number;
    TimeLength: number;
    Note: number;     // MIDI note number (21–108 for 88-key)
    Velocity: number; // 0–127
    Hand?: 'left' | 'right'; // optional — absent means unknown, treated as right
}

export interface SongKeyboardNotes {
    Sections: SongSection[];
    Notes: SongKeyboardNote[];
}
