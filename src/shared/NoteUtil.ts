// ENoteName and EChordType as const objects (erasableSyntaxOnly forbids runtime enums).
export const ENoteName = {
    C:    0,
    CsDf: 1,
    D:    2,
    DsEf: 3,
    E:    4,
    F:    5,
    FsGf: 6,
    G:    7,
    GsAf: 8,
    A:    9,
    AsBf: 10,
    B:    11,
} as const;
export type ENoteName = typeof ENoteName[keyof typeof ENoteName];

export const EChordType = { Maj: 0, Min: 1 } as const;
export type EChordType = typeof EChordType[keyof typeof EChordType];

const HALF_STEP_RATIO = Math.pow(2.0, 1.0 / 12.0);
const A4_FREQUENCY    = 440.0;
const A4_MIDI_NOTE    = 57;

export const Scales: Record<EChordType, number[]> = {
    [EChordType.Maj]: [0, 2, 4, 5, 7, 9, 11],
    [EChordType.Min]: [0, 2, 3, 5, 7, 8, 11],
};

export function getMidiNoteFrequency(midiNoteNum: number): number {
    return A4_FREQUENCY / Math.pow(HALF_STEP_RATIO, A4_MIDI_NOTE - midiNoteNum);
}

export function getNoteName(midiNoteNum: number): ENoteName {
    return (midiNoteNum % 12) as ENoteName;
}

export function getNoteOctave(midiNoteNum: number): number {
    return Math.floor(midiNoteNum / 12) - 1;
}

export function getMidiNoteNumber(note: ENoteName, octave: number): number {
    return (octave + 1) * 12 + note;
}

export function getSemitoneDifference(freq1: number, freq2: number): number {
    return 12 * Math.log2(freq1 / freq2);
}

export function tryParseNoteName(noteStr: string): { note: ENoteName; octave: number } | null {
    const s = noteStr.toLowerCase().trim();

    const twoChar: Array<[string[], ENoteName]> = [
        [["cs", "df"], ENoteName.CsDf],
        [["ds", "ef"], ENoteName.DsEf],
        [["fs", "gf"], ENoteName.FsGf],
        [["gs", "af"], ENoteName.GsAf],
        [["as", "bf"], ENoteName.AsBf],
    ];

    for (const [prefixes, note] of twoChar) {
        for (const p of prefixes) {
            if (s.startsWith(p)) {
                const octave = parseInt(s.slice(2), 10);
                return isNaN(octave) ? null : { note, octave };
            }
        }
    }

    const oneChar: Array<[string, ENoteName]> = [
        ["c", ENoteName.C],
        ["d", ENoteName.D],
        ["e", ENoteName.E],
        ["f", ENoteName.F],
        ["g", ENoteName.G],
        ["a", ENoteName.A],
        ["b", ENoteName.B],
    ];

    for (const [prefix, note] of oneChar) {
        if (s.startsWith(prefix)) {
            const octave = parseInt(s.slice(1), 10);
            return isNaN(octave) ? null : { note, octave };
        }
    }

    return null;
}
