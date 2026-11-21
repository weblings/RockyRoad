// Recorded mono-guitar run: one tick per frame, as JSONL lines through debugLog.
// Lets a parity test replay the same ticks through NoteDetector and NoteScorer.

import type { SongNote } from './SongFormat';

export interface MonoRunHeader {
    /** Per-note chart data NoteDetector needs to derive its targets. */
    notes: { time: number; string: number; fret: number }[];
    tuningOffsets: number[];
}

export interface MonoTick {
    sec: number;
    /** Detected Hz, null when the detector heard nothing. */
    hz: number | null;
    /** Grace period end at tick time, null when none. */
    grace: number | null;
}

export type MonoEvent = ({ kind: 'tick' } & MonoTick) | { kind: 'reset' };

export interface RecordedMonoRun extends MonoRunHeader {
    events: MonoEvent[];
    /** Target indices the live run hit, when the run ended cleanly. */
    liveHits: number[] | null;
}

type Emit = (event: string, data: Record<string, unknown>) => void;

export class MonoRunRecorder {
    private readonly emit: Emit;

    constructor(emit: Emit) { this.emit = emit; }

    start(notes: readonly SongNote[], tuningOffsets: readonly number[]): void {
        this.emit('mono-run-start', {
            notes: notes.map(n => ({ time: n.TimeOffset, string: n.String, fret: n.Fret })),
            tuningOffsets: [...tuningOffsets],
        });
    }

    tick(t: MonoTick): void { this.emit('mono-tick', { ...t }); }

    reset(): void { this.emit('mono-reset', {}); }

    end(notesDetected: Int8Array): void {
        const hits: number[] = [];
        notesDetected.forEach((v, i) => { if (v === 1) hits.push(i); });
        this.emit('mono-run-end', { hits });
    }
}

/** Parses debug-log JSONL into mono runs. Skips unrelated and truncated lines. */
export function parseMonoRuns(text: string): RecordedMonoRun[] {
    const runs: RecordedMonoRun[] = [];
    let cur: RecordedMonoRun | null = null;
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let o: Record<string, any>;
        try { o = JSON.parse(line); } catch { continue; }
        switch (o.event) {
            case 'mono-run-start':
                cur = { notes: o.notes, tuningOffsets: o.tuningOffsets, events: [], liveHits: null };
                runs.push(cur);
                break;
            case 'mono-tick':
                cur?.events.push({ kind: 'tick', sec: o.sec, hz: o.hz, grace: o.grace });
                break;
            case 'mono-reset': cur?.events.push({ kind: 'reset' }); break;
            case 'mono-run-end': if (cur) cur.liveHits = o.hits; break;
        }
    }
    return runs;
}
