// Pure onset logic for Polyphon frames: rising edges only, gated to expected pitches.
// Kept free of the detector so recorded frames can be replayed through it.

import type { NoteTarget } from './NoteInput';
import type { RawDetection } from './NoteTimeMapper';
import type { PolyphonConfig } from './PolyphonConfig';

export interface FrameNote {
    midi: number;
    prob: number;
}

/** Pitches with a target within `window` song seconds of `t`. `targets` must be sorted by time. */
export function expectedPitches(targets: readonly NoteTarget[], t: number, window: number): Set<number> {
    const set = new Set<number>();
    // Linear scan is fine at frame rate for a song-sized array, bounded by the window.
    for (const tg of targets) {
        if (tg.time > t + window) break;
        if (tg.time >= t - window) set.add(tg.midi);
    }
    return set;
}

/** Turns per-frame notes into onsets. A second detector plugs in by implementing this. */
export interface OnsetStage {
    process(notes: readonly FrameNote[], expected: ReadonlySet<number> | null): RawDetection[];
}

export class PolyphonOnsets implements OnsetStage {
    // Per held pitch: lowest probability seen since it turned on or last fired.
    private readonly held = new Map<number, number>();
    private readonly cfg: Pick<PolyphonConfig, 'minProb' | 'retriggerRise'>;

    constructor(cfg: Pick<PolyphonConfig, 'minProb' | 'retriggerRise'>) {
        this.cfg = cfg;
    }

    /** `expected` is the set of pitches with a target in the window, null disables gating. */
    process(notes: readonly FrameNote[], expected: ReadonlySet<number> | null): RawDetection[] {
        const out: RawDetection[] = [];
        const seen = new Set<number>();
        for (const n of notes) {
            seen.add(n.midi);
            const low = this.held.get(n.midi);
            let fire = false;
            if (low === undefined) {
                fire = n.prob >= this.cfg.minProb;
                this.held.set(n.midi, n.prob);
            } else {
                const min = Math.min(low, n.prob);
                const rise = this.cfg.retriggerRise;
                fire = rise > 0 && n.prob - min >= rise && n.prob >= this.cfg.minProb;
                this.held.set(n.midi, fire ? n.prob : min);
            }
            if (fire && (!expected || expected.has(n.midi))) out.push({ midi: n.midi, confidence: n.prob });
        }
        for (const midi of this.held.keys()) if (!seen.has(midi)) this.held.delete(midi);
        return out;
    }

    reset(): void { this.held.clear(); }
}
