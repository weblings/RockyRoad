// NoteFramePipeline — detector frames to scored hits. Shared by live play and offline
// replay so a recorded run scores exactly like the live one.

import type { NoteObservation, NoteTarget } from './NoteInput';
import { NoteScorer } from './NoteScorer';
import { NoteTimeMapper, type LatencyBreakdown, type TimeSource } from './NoteTimeMapper';
import type { PolyphonConfig } from './PolyphonConfig';
import { expectedPitches, PolyphonOnsets, type FrameNote, type OnsetStage } from './PolyphonOnsets';

export interface ScorerSettings {
    tolerance: number;
    octaveFold: boolean;
}

export interface FramePipelineOptions {
    targets: readonly NoteTarget[];
    notesDetected: Int8Array;
    time: TimeSource;
    latency: () => LatencyBreakdown;
    config: Pick<PolyphonConfig, 'minProb' | 'retriggerRise' | 'gateWindow'>;
    scorer: ScorerSettings;
    devOffset?: number;
    /** Swap in another detector's onset logic. Defaults to Polyphon's. */
    onsets?: OnsetStage;
    onHit?: (obs: NoteObservation, target: NoteTarget, index: number) => void;
}

export class NoteFramePipeline {
    /** Observations handed to the scorer, hit or not. */
    observed = 0;

    private readonly opts: FramePipelineOptions;
    private readonly onsets: OnsetStage;
    private readonly mapper: NoteTimeMapper;
    private readonly scorer: NoteScorer;

    constructor(opts: FramePipelineOptions) {
        this.opts = opts;
        this.onsets = opts.onsets ?? new PolyphonOnsets(opts.config);
        this.mapper = new NoteTimeMapper(opts.time, opts.latency);
        this.mapper.devOffset = opts.devOffset ?? 0;
        this.scorer = new NoteScorer(
            // Sweep in the same latency-shifted time as the stamps, or late notes get swept before they match.
            opts.targets, opts.notesDetected, () => this.mapper.latencyAdjustedSecond(),
            () => null, // Keys has no grace period yet
            { ...opts.scorer, onHit: opts.onHit },
        );
    }

    /** Call at detector callback time, with the time source reading that moment. */
    feed(notes: readonly FrameNote[]): void {
        const expected = expectedPitches(this.opts.targets, this.mapper.latencyAdjustedSecond(), this.opts.config.gateWindow);
        const raw = this.onsets.process(notes, expected);
        const obs = raw.length ? this.mapper.map(raw) : [];
        this.observed += obs.length;
        this.scorer.tick(obs); // also sweeps misses at the frame's song time
    }

    /** Miss sweep without observations, for the render loop. */
    sweep(): void { this.scorer.tick([]); }

    /** Seek or rollback. Clears results, keeps onset hold state. */
    reset(): void {
        this.scorer.reset();
        this.observed = 0;
    }
}
