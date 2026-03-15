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

export interface SongNote extends ISongEvent {
    TimeOffset: number;
    TimeLength: number;
    EndTime: number;
    Fret: number;
    String: number;
    HandFret: number;
    SlideFret?: number;
    FingerID?: number;
    Techniques?: string;
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
