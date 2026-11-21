// Recorded detector run: raw frames plus the song clock, as JSONL lines through debugLog.
// Frames are pre-onset, so another adapter's frames can be scored with its own OnsetStage.

import type { NoteTarget } from './NoteInput';
import type { ScorerSettings } from './NoteFramePipeline';
import type { LatencyBreakdown } from './NoteTimeMapper';
import type { PolyphonConfig } from './PolyphonConfig';
import type { FrameNote } from './PolyphonOnsets';

export interface RunHeader {
    /** Detector that produced the frames, e.g. 'polyphon'. Picks the onset stage on replay. */
    source: string;
    config: PolyphonConfig;
    latency: LatencyBreakdown;
    devOffset: number;
    scorer: ScorerSettings;
    targets: NoteTarget[];
}

export interface FrameClock {
    sec: number;
    playing: boolean;
    rate: number;
}

export type RunEvent =
    | ({ kind: 'frame'; notes: FrameNote[] } & FrameClock)
    | { kind: 'reset' };

export interface RecordedRun extends RunHeader {
    events: RunEvent[];
    /** Target indices the live run hit, when the run ended cleanly. */
    liveHits: number[] | null;
}

type Emit = (event: string, data: Record<string, unknown>) => void;

export class RunRecorder {
    private readonly emit: Emit;

    constructor(emit: Emit) { this.emit = emit; }

    start(header: RunHeader): void { this.emit('run-start', { ...header }); }

    frame(clock: FrameClock, notes: readonly FrameNote[]): void {
        this.emit('frame', { ...clock, notes: notes.map(n => [n.midi, n.prob]) });
    }

    reset(): void { this.emit('reset', {}); }

    end(notesDetected: Int8Array): void {
        const hits: number[] = [];
        notesDetected.forEach((v, i) => { if (v === 1) hits.push(i); });
        this.emit('run-end', { hits });
    }
}

/** Parses debug-log JSONL into runs. Skips unrelated and truncated lines. */
export function parseRuns(text: string): RecordedRun[] {
    const runs: RecordedRun[] = [];
    let cur: RecordedRun | null = null;
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let o: Record<string, any>;
        try { o = JSON.parse(line); } catch { continue; }
        switch (o.event) {
            case 'run-start': {
                const { source, config, latency, devOffset, scorer, targets } = o;
                cur = { source, config, latency, devOffset, scorer, targets, events: [], liveHits: null };
                runs.push(cur);
                break;
            }
            case 'frame':
                cur?.events.push({
                    kind: 'frame', sec: o.sec, playing: o.playing, rate: o.rate,
                    notes: (o.notes as [number, number][]).map(([midi, prob]) => ({ midi, prob })),
                });
                break;
            case 'reset': cur?.events.push({ kind: 'reset' }); break;
            case 'run-end': if (cur) cur.liveHits = o.hits; break;
        }
    }
    return runs;
}
