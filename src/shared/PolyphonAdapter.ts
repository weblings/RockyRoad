// PolyphonAdapter — wraps pitchplease on the MicSource stream and emits raw frames.
// NoteFramePipeline turns them into onsets, stamps them and scores them.

import { create, type Detector } from '@markusstrasser/pitchplease';
import { micSource } from './MicSource';
import { DEFAULT_POLYPHON_CONFIG, type PolyphonConfig } from './PolyphonConfig';
import type { FrameNote } from './PolyphonOnsets';

export interface PolyphonAdapterOptions {
    config?: PolyphonConfig;
    /** Every detector callback, including empty frames. */
    onFrame: (notes: readonly FrameNote[]) => void;
    onError?: (err: unknown) => void;
}

export class PolyphonAdapter {
    private detector: Detector | null = null;
    private readonly cfg: PolyphonConfig;
    private readonly opts: PolyphonAdapterOptions;

    constructor(opts: PolyphonAdapterOptions) {
        this.opts = opts;
        this.cfg = opts.config ?? DEFAULT_POLYPHON_CONFIG;
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
            onNotes: notes => this.opts.onFrame(notes),
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
    }
}
