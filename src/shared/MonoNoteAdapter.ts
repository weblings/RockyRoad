// Adapts the mono PitchDetector and a guitar/bass chart to NoteScorer's input types.

import type { SongNote } from './SongFormat';
import type { PitchResult } from './PitchDetector';
import { STANDARD_BASE_NOTES } from './SongIndex';
import { hzToMidi, type NoteObservation, type NoteTarget } from './NoteInput';
import type { NoteScorerOptions } from './NoteScorer';

// +-50 cents, one octave of fold either way. Matches the retired NoteDetector.
export const MONO_SCORER_OPTIONS: Partial<NoteScorerOptions> = {
    tolerance: 0.5, octaveFold: true, maxOctaves: 1,
};

/** One observation per frame with a pitch, none otherwise. `time` is song seconds. */
export function monoObservations(result: PitchResult | null, time: number): NoteObservation[] {
    if (result === null) return [];
    return [{ time, midi: hzToMidi(result.frequency), confidence: result.clarity }];
}

/** Targets in chart order. `notes` must be sorted by time. */
export function stringedTargets(
    notes: readonly Pick<SongNote, 'TimeOffset' | 'String' | 'Fret'>[],
    tuningOffsets: readonly number[],
): NoteTarget[] {
    const base = STANDARD_BASE_NOTES[tuningOffsets.length] ?? [];
    return notes.map(n => ({
        time: n.TimeOffset,
        midi: (base[n.String] ?? 69) + (tuningOffsets[n.String] ?? 0) + n.Fret,
    }));
}
