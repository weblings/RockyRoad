// Source-agnostic note input types. Detectors (mono pitch, Polyphon, MIDI) adapt
// their output to NoteObservation, and NoteScorer consumes them.

/** One detected note. `time` is in song seconds, `midi` may be fractional. */
export interface NoteObservation {
    time: number;
    midi: number;
    confidence: number;  // 0-1, scorer ignores it for now
}

/** One note to be played. `midi` is an integer pitch, `time` is in song seconds. */
export interface NoteTarget {
    time: number;
    midi: number;
}

export function hzToMidi(hz: number): number {
    return 69 + 12 * Math.log2(hz / 440);
}
