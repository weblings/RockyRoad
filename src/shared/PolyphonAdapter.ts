// PolyphonAdapter — wraps pitchplease on the MicSource stream and emits gated onsets.
// The consumer stamps them with NoteTimeMapper and feeds NoteScorer.

import { create, type Detector } from '@markusstrasser/pitchplease';
import { micSource } from './MicSource';
import type { NoteTarget } from './NoteInput';
import type { RawDetection } from './NoteTimeMapper';
import { DEFAULT_POLYPHON_CONFIG, type PolyphonConfig } from './PolyphonConfig';
import { PolyphonOnsets } from './PolyphonOnsets';

export interface PolyphonAdapterOptions {
    config?: PolyphonConfig;
    onOnsets: (raw: RawDetection[]) => void;
    /** Current song second, used to find targets near now. */
    currentSecond: () => number;
    /** Targets sorted by time. Null disables gating. */
    targets: () => readonly NoteTarget[] | null;
    onError?: (err: unknown) => void;
}

export class PolyphonAdapter {
    private detector: Detector | null = null;
    private readonly cfg: PolyphonConfig;
    private readonly onsets: PolyphonOnsets;
    private readonly opts: PolyphonAdapterOptions;

    constructor(opts: PolyphonAdapterOptions) {
        this.opts = opts;
        this.cfg = opts.config ?? DEFAULT_POLYPHON_CONFIG;
        this.onsets = new PolyphonOnsets(this.cfg);
    }

    get stats() { return this.detector?.stats ?? null; }

    /** Borrows the shared mic stream. False if the mic is unavailable or the detector failed. */
    async start(): Promise<boolean> {
        if (this.detector) return true;
        await micSource.acquire();
        const stream = micSource.currentStream;
        if (!stream) return false;
        const det = create({
            model: this.cfg.model,
            assetBaseUrl: this.cfg.assetBaseUrl,
            ...(this.cfg.threshold ? { threshold: this.cfg.threshold } : {}),
            onNotes: notes => this.handle(notes),
            onError: err => this.opts.onError?.(err),
        });
        this.detector = det;
        const ok = await det.start(stream);
        if (!ok) this.detector = null;
        return ok;
    }

    stop(): void {
        this.detector?.stop();
        this.detector = null;
        this.onsets.reset();
    }

    private handle(notes: readonly { midi: number; prob: number }[]): void {
        const raw = this.onsets.process(notes, this.expectedPitches());
        if (raw.length) this.opts.onOnsets(raw);
    }

    private expectedPitches(): Set<number> | null {
        const targets = this.opts.targets();
        if (!targets) return null;
        const t = this.opts.currentSecond();
        const w = this.cfg.gateWindow;
        const set = new Set<number>();
        // Linear scan is fine at frame rate for a song-sized array, bounded by the window.
        for (const tg of targets) {
            if (tg.time > t + w) break;
            if (tg.time >= t - w) set.add(tg.midi);
        }
        return set;
    }
}
