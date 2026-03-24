// NoteDetector — single-note hit/miss scoring against a song chart.
//
// Design mirrors C# NoteDetector.cs: poll-based (no onset detection), binary hit/miss,
// ±50¢ pitch tolerance (~0.5 semitone), ±150ms timing window.
//
// Usage:
//   const det = new NoteDetector(notes, part, () => songPlayer.currentSecond,
//                                notesDetected, () => scene.gracePeriodEndTime);
//   // each rAF tick:
//   det.tick(pitchDetector.detect());
//   // after seek/rollback:
//   det.reset();

import type { SongNote } from './SongFormat';
import type { SongIndexPart } from './SongIndex';
import { STANDARD_BASE_NOTES } from './SongIndex';
import type { PitchResult } from './PitchDetector';

// ±150ms window around note TimeOffset for both hit detection and miss marking.
const HIT_WINDOW_SECS = 0.15;
// ±50¢ pitch tolerance — matches C# validPitchRatio of 0.5 semitones.
const HIT_CENTS = 50;

export class NoteDetector {
    private readonly notes: SongNote[];
    private readonly notesDetected: Int8Array;
    private readonly targetFreqs: Float32Array;    // precomputed Hz per note
    private readonly currentSecond: () => number;
    private readonly gracePeriodEndTime: () => number | null;

    // First index not yet fully past the miss window — lets sweepMisses and
    // matchHit skip already-resolved notes without scanning from 0 each frame.
    private scanPos = 0;

    constructor(
        notes: SongNote[],
        part: SongIndexPart,
        currentSecond: () => number,
        notesDetected: Int8Array,
        gracePeriodEndTime: () => number | null,
    ) {
        this.notes           = notes;
        this.notesDetected   = notesDetected;
        this.currentSecond   = currentSecond;
        this.gracePeriodEndTime = gracePeriodEndTime;

        // Precompute target frequency for every note so matchHit is just a lookup.
        const offsets = part.tuningOffsets ?? [];
        const n       = offsets.length;
        const base    = STANDARD_BASE_NOTES[n] ?? [];
        this.targetFreqs = new Float32Array(notes.length);
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            const midi = (base[note.String] ?? 69) + (offsets[note.String] ?? 0) + note.Fret;
            this.targetFreqs[i] = 440 * Math.pow(2, (midi - 69) / 12);
        }
    }

    /** Call every rAF tick with the latest pitch detection result (may be null = no signal). */
    tick(result: PitchResult | null): void {
        const t = this.currentSecond();
        this.sweepMisses(t);
        if (result !== null) this.matchHit(result.frequency, t);
    }

    /** Reset all scoring state — call after seek or rollback. */
    reset(): void {
        this.notesDetected.fill(0);
        this.scanPos = 0;
    }

    // ── Job A: miss sweep ─────────────────────────────────────────────────────
    // Mark notes that have passed the miss window without being hit.
    // Advances scanPos past any note that is now fully resolved.

    private sweepMisses(t: number): void {
        const grace = this.gracePeriodEndTime();

        for (let i = this.scanPos; i < this.notes.length; i++) {
            const note = this.notes[i];

            // Note is still in the future or within the hit window — stop here.
            if (note.TimeOffset > t - HIT_WINDOW_SECS) break;

            // Note is past the miss window and unscored — mark miss (unless grace).
            if (this.notesDetected[i] === 0) {
                const inGrace = grace !== null && note.TimeOffset < grace;
                if (!inGrace) this.notesDetected[i] = -1;
            }

            // Advance scanPos: this note is fully resolved (hit, miss, or grace).
            this.scanPos = i + 1;
        }
    }

    // ── Job B: hit matching ───────────────────────────────────────────────────
    // When a pitch is detected, find the unscored note within the timing window
    // whose expected frequency is closest to the detected frequency.
    // If multiple notes match the pitch, take the one nearest in time.

    private matchHit(detectedFreq: number, t: number): void {
        const grace = this.gracePeriodEndTime();
        let bestIdx  = -1;
        let bestDist = Infinity;

        for (let i = this.scanPos; i < this.notes.length; i++) {
            const note = this.notes[i];
            if (note.TimeOffset > t + HIT_WINDOW_SECS) break;   // beyond window
            if (this.notesDetected[i] !== 0) continue;           // already scored

            const inGrace = grace !== null && note.TimeOffset < grace;
            if (inGrace) continue;

            const cents = centDeviationOctaveCorrect(detectedFreq, this.targetFreqs[i]);
            if (Math.abs(cents) <= HIT_CENTS) {
                const timeDist = Math.abs(note.TimeOffset - t);
                if (timeDist < bestDist) { bestDist = timeDist; bestIdx = i; }
            }
        }

        if (bestIdx >= 0) this.notesDetected[bestIdx] = 1;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns cents deviation between detectedFreq and targetFreq, with octave
// correction: autocorrelation can lock an octave harmonic, so check ±1200¢
// and return whichever is closest to 0.
function centDeviationOctaveCorrect(detectedFreq: number, targetFreq: number): number {
    const raw   = 1200 * Math.log2(detectedFreq / targetFreq);
    const below = raw - 1200;
    const above = raw + 1200;
    return [raw, below, above].reduce((best, c) => Math.abs(c) < Math.abs(best) ? c : best);
}
