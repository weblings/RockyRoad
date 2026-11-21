// NoteTimeMapper — stamps raw detector output in song seconds for NoteScorer.
// Song time = currentSecond - (total latency) * playbackRate, dropped while paused.

import type { NoteObservation, NoteTarget } from './NoteInput';

/** Latencies in real seconds. Scaled by playback rate when converted to song time. */
export interface LatencyBreakdown {
    detector: number;
    input: number;
    delivery: number;
    output: number;
}

export interface RawDetection {
    midi: number;
    confidence: number;
}

export interface TimeSource {
    readonly isPlaying: boolean;
    readonly currentSecond: number;
    readonly playbackRate: number;
}

export function totalLatency(l: LatencyBreakdown, devOffset = 0): number {
    return l.detector + l.input + l.delivery + l.output + devOffset;
}

export class NoteTimeMapper {
    /** Dev offset in real seconds, added to the latency sum. */
    devOffset = 0;

    private readonly player: TimeSource;
    private readonly latency: () => LatencyBreakdown;

    constructor(player: TimeSource, latency: () => LatencyBreakdown) {
        this.player = player;
        this.latency = latency;
    }

    /** Call at detector callback time. Returns null while paused. */
    map(raw: readonly RawDetection[]): NoteObservation[] {
        if (!this.player.isPlaying) return [];
        const shift = totalLatency(this.latency(), this.devOffset) * this.player.playbackRate;
        const time = this.player.currentSecond - shift;
        return raw.map(r => ({ time, midi: r.midi, confidence: r.confidence }));
    }
}

export interface HitDelta {
    targetIndex: number;
    target: number;
    observed: number;
    delta: number;
}

/** Collects (observed - target) per hit. Pass `record` as the scorer's onHit. */
export class HitDeltaLog {
    readonly entries: HitDelta[] = [];

    readonly record = (obs: NoteObservation, target: NoteTarget, index: number): void => {
        const entry = {
            targetIndex: index, target: target.time, observed: obs.time, delta: obs.time - target.time,
        };
        this.entries.push(entry);
        console.log(`[hit-delta] #${index} midi ${target.midi} ${(entry.delta * 1000).toFixed(0)} ms`);
    };

    meanMs(): number {
        if (!this.entries.length) return 0;
        return this.entries.reduce((s, e) => s + e.delta, 0) / this.entries.length * 1000;
    }

    clear(): void { this.entries.length = 0; }
}
