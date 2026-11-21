// NoteScorer — instrument-agnostic hit/miss scoring. Same rules as NoteDetector:
// ±150 ms window, grace period, reset, miss sweep, results in notesDetected.
// notesDetected values: 0 pending, 1 hit, -1 miss.

import type { NoteObservation, NoteTarget } from './NoteInput';

// ±150ms window around target time for both hit detection and miss marking.
export const HIT_WINDOW_SECS = 0.15;

export interface NoteScorerOptions {
    /** Max |observed - target| in semitones. 0.5 for mono, 0 for exact sources. */
    tolerance: number;
    /** Compare pitch classes so any octave of the target counts. */
    octaveFold: boolean;
    /** With octaveFold, the most octaves away from the target that still counts. */
    maxOctaves: number;
    /** Called for every hit, e.g. to log (observed - target). */
    onHit?: (obs: NoteObservation, target: NoteTarget, index: number) => void;
}

const DEFAULTS: NoteScorerOptions = { tolerance: 0.5, octaveFold: false, maxOctaves: Infinity };

export class NoteScorer {
    private readonly opts: NoteScorerOptions;
    // First index not yet past the miss window, so scans skip resolved notes.
    private scanPos = 0;

    private readonly targets: readonly NoteTarget[];
    private readonly notesDetected: Int8Array;
    private readonly currentSecond: () => number;
    private readonly gracePeriodEndTime: () => number | null;

    /** `targets` must be sorted by time. */
    constructor(
        targets: readonly NoteTarget[],
        notesDetected: Int8Array,
        currentSecond: () => number,
        gracePeriodEndTime: () => number | null,
        options: Partial<NoteScorerOptions> = {},
    ) {
        this.targets = targets;
        this.notesDetected = notesDetected;
        this.currentSecond = currentSecond;
        this.gracePeriodEndTime = gracePeriodEndTime;
        this.opts = { ...DEFAULTS, ...options };
    }

    /** Sweep misses at the current song time, then match each observation. */
    tick(observations: readonly NoteObservation[]): void {
        this.sweepMisses(this.currentSecond());
        for (const obs of observations) this.matchHit(obs);
    }

    reset(): void {
        this.notesDetected.fill(0);
        this.scanPos = 0;
    }

    private sweepMisses(t: number): void {
        const grace = this.gracePeriodEndTime();
        for (let i = this.scanPos; i < this.targets.length; i++) {
            const target = this.targets[i];
            if (target.time > t - HIT_WINDOW_SECS) break;
            if (this.notesDetected[i] === 0) {
                const inGrace = grace !== null && target.time < grace;
                if (!inGrace) this.notesDetected[i] = -1;
            }
            this.scanPos = i + 1;
        }
    }

    private matchHit(obs: NoteObservation): void {
        const grace = this.gracePeriodEndTime();
        let bestIdx = -1;
        let bestTime = Infinity;
        let bestPitch = Infinity;

        for (let i = this.scanPos; i < this.targets.length; i++) {
            const target = this.targets[i];
            if (target.time > obs.time + HIT_WINDOW_SECS) break;
            if (this.notesDetected[i] !== 0) continue;
            if (grace !== null && target.time < grace) continue;

            const pitchDist = this.pitchDistance(obs.midi, target.midi);
            if (pitchDist > this.opts.tolerance) continue;

            // Closest in time wins, ties go to the closer pitch, then the earlier note.
            const timeDist = Math.abs(target.time - obs.time);
            if (timeDist < bestTime || (timeDist === bestTime && pitchDist < bestPitch)) {
                bestTime = timeDist;
                bestPitch = pitchDist;
                bestIdx = i;
            }
        }

        if (bestIdx >= 0) {
            this.notesDetected[bestIdx] = 1;
            this.opts.onHit?.(obs, this.targets[bestIdx], bestIdx);
        }
    }

    private pitchDistance(observed: number, target: number): number {
        const d = observed - target;
        if (!this.opts.octaveFold) return Math.abs(d);
        const octaves = Math.max(-this.opts.maxOctaves, Math.min(this.opts.maxOctaves, Math.round(d / 12)));
        return Math.abs(d - 12 * octaves);
    }
}
