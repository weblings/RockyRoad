// Offline scoring of a recorded run. Overrides retune onsets, offset and scorer without replaying.

import type { RecordedRun } from './FrameRecording';
import { NoteFramePipeline, type ScorerSettings } from './NoteFramePipeline';
import { PolyphonOnsets, type OnsetStage } from './PolyphonOnsets';
import type { PolyphonConfig } from './PolyphonConfig';

export interface ReplayOverrides {
    /** Onset tuning only. model and threshold act inside the detector, so they cannot change here. */
    config?: Partial<Pick<PolyphonConfig, 'minProb' | 'retriggerRise' | 'gateWindow'>>;
    /** Replaces the recorded dev offset, in real seconds. */
    devOffset?: number;
    scorer?: Partial<ScorerSettings>;
}

export interface DeltaStats {
    n: number;
    meanMs: number;
    medianMs: number;
    stdMs: number;
    minMs: number;
    maxMs: number;
    p10Ms: number;
    p90Ms: number;
    /** Counts per bucket, keyed by bucket start in ms. */
    histogram: { fromMs: number; count: number }[];
}

export interface ReplayResult {
    targets: number;
    hits: number;
    misses: number;
    pending: number;
    hitRate: number;
    /** Observations scored that matched nothing. */
    extraOnsets: number;
    hitIndices: number[];
    deltas: DeltaStats | null;
    /** True/false when the run recorded its live hits, null otherwise. */
    matchesLive: boolean | null;
}

const BUCKET_MS = 25;

/** Source name to onset stage. A second adapter registers here. */
const STAGES: Record<string, (cfg: PolyphonConfig) => OnsetStage> = {
    polyphon: cfg => new PolyphonOnsets(cfg),
};

export function replayRun(run: RecordedRun, over: ReplayOverrides = {}): ReplayResult {
    const make = STAGES[run.source];
    if (!make) throw new Error(`No onset stage for source "${run.source}"`);
    const config = { ...run.config, ...over.config };
    const notesDetected = new Int8Array(run.targets.length);
    const deltas: number[] = [];
    // The pipeline reads this at feed time, like it reads the live player.
    const time = { isPlaying: true, currentSecond: 0, playbackRate: 1 };
    const pipe = new NoteFramePipeline({
        targets: run.targets, notesDetected, time,
        latency: () => run.latency,
        config,
        scorer: { ...run.scorer, ...over.scorer },
        devOffset: over.devOffset ?? run.devOffset,
        onsets: make(config),
        onHit: (obs, target) => deltas.push(obs.time - target.time),
    });

    for (const e of run.events) {
        if (e.kind === 'reset') {
            pipe.reset();
            deltas.length = 0;
            continue;
        }
        time.isPlaying = e.playing;
        time.currentSecond = e.sec;
        time.playbackRate = e.rate;
        pipe.feed(e.notes);
    }

    const hitIndices: number[] = [];
    let misses = 0;
    notesDetected.forEach((v, i) => { if (v === 1) hitIndices.push(i); else if (v === -1) misses++; });
    const hits = hitIndices.length;
    return {
        targets: run.targets.length,
        hits,
        misses,
        pending: run.targets.length - hits - misses,
        hitRate: run.targets.length ? hits / run.targets.length : 0,
        extraOnsets: pipe.observed - hits,
        hitIndices,
        deltas: deltaStats(deltas),
        matchesLive: run.liveHits ? sameIndices(run.liveHits, hitIndices) : null,
    };
}

function sameIndices(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

function quantile(sorted: number[], q: number): number {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function deltaStats(deltasSec: readonly number[]): DeltaStats | null {
    if (!deltasSec.length) return null;
    const ms = deltasSec.map(d => d * 1000).sort((a, b) => a - b);
    const mean = ms.reduce((s, v) => s + v, 0) / ms.length;
    const variance = ms.reduce((s, v) => s + (v - mean) ** 2, 0) / ms.length;
    const buckets = new Map<number, number>();
    for (const v of ms) {
        const from = Math.floor(v / BUCKET_MS) * BUCKET_MS;
        buckets.set(from, (buckets.get(from) ?? 0) + 1);
    }
    return {
        n: ms.length,
        meanMs: mean,
        medianMs: quantile(ms, 0.5),
        stdMs: Math.sqrt(variance),
        minMs: ms[0],
        maxMs: ms[ms.length - 1],
        p10Ms: quantile(ms, 0.1),
        p90Ms: quantile(ms, 0.9),
        histogram: [...buckets].sort((a, b) => a[0] - b[0]).map(([fromMs, count]) => ({ fromMs, count })),
    };
}

export function formatResult(r: ReplayResult): string {
    const lines = [
        `targets ${r.targets}  hits ${r.hits}  misses ${r.misses}  pending ${r.pending}`,
        `hit rate ${(r.hitRate * 100).toFixed(1)}%  extra onsets ${r.extraOnsets}`,
    ];
    if (r.matchesLive !== null) lines.push(`matches live run: ${r.matchesLive ? 'yes' : 'NO'}`);
    const d = r.deltas;
    if (!d) return lines.join('\n');
    const f = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`;
    lines.push(
        `delta (observed - target) ms, n=${d.n}`,
        `  mean ${f(d.meanMs)}  median ${f(d.medianMs)}  std ${d.stdMs.toFixed(0)}  min ${f(d.minMs)}  max ${f(d.maxMs)}  p10 ${f(d.p10Ms)}  p90 ${f(d.p90Ms)}`,
    );
    const peak = Math.max(...d.histogram.map(b => b.count));
    for (const b of d.histogram) {
        lines.push(`  ${f(b.fromMs).padStart(5)} | ${'#'.repeat(Math.max(1, Math.round(b.count / peak * 30)))} ${b.count}`);
    }
    return lines.join('\n');
}
