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
