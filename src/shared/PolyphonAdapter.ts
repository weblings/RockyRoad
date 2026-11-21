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
    private gainCtx: AudioContext | null = null;
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
        const mic = micSource.currentStream;
        if (!mic) return false;
        const stream = this.cfg.gain === 1 ? mic : this.applyGain(mic);
        const det = create({
            model: this.cfg.model,
            assetBaseUrl: this.cfg.assetBaseUrl,
            ...(this.cfg.threshold ? { threshold: this.cfg.threshold } : {}),
            onNotes: notes => this.opts.onFrame(notes),
            onError: err => this.opts.onError?.(err),
        });
        this.detector = det;
        const ok = await det.start(stream);
        if (!ok) { this.detector = null; this.closeGain(); }
        return ok;
    }

    // Gain runs on a copy of the stream, so the shared mic and the tuner stay untouched.
    private applyGain(mic: MediaStream): MediaStream {
        const ctx = new AudioContext();
        const gain = ctx.createGain();
        gain.gain.value = this.cfg.gain;
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(mic).connect(gain).connect(dest);
        this.gainCtx = ctx;
        return dest.stream;
    }

    private closeGain(): void {
        void this.gainCtx?.close();
        this.gainCtx = null;
    }

    stop(): void {
        this.detector?.stop();
        this.detector = null;
        this.closeGain();
    }
}
