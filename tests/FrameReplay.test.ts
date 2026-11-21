import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunRecorder, parseRuns, type RunHeader } from '../src/shared/FrameRecording';
import { NoteFramePipeline } from '../src/shared/NoteFramePipeline';
import { deltaStats, formatResult, replayRun } from '../src/shared/FrameReplay';
import { DEFAULT_POLYPHON_CONFIG } from '../src/shared/PolyphonConfig';

const targets = [
    { time: 1.0, midi: 60 }, { time: 1.5, midi: 60 },
    { time: 2.0, midi: 64 }, { time: 2.0, midi: 67 }, { time: 3.0, midi: 72 },
];
const header: RunHeader = {
    source: 'polyphon',
    config: { ...DEFAULT_POLYPHON_CONFIG, retriggerRise: 0.2 },
    latency: { detector: 0.05, input: 0.02, delivery: 0.02, output: 0.03 },
    devOffset: 0,
    scorer: { tolerance: 0, octaveFold: false },
    targets,
};

// Frame stream at 20 ms: each note sounds for 100 ms starting at `at`, with the detector 0.1 s late.
function stream(lag: number): { sec: number; notes: { midi: number; prob: number }[] }[] {
    const sounding = [[1.0, 60], [1.5, 60], [2.0, 64], [2.0, 67]];
    const out = [];
    for (let sec = 0; sec <= 3.5; sec += 0.02) {
        const notes = sounding
            .filter(([at]) => sec >= at + lag && sec < at + lag + 0.1)
            .map(([, midi]) => ({ midi, prob: 0.9 }));
        out.push({ sec: Math.round(sec * 1000) / 1000, notes });
    }
    return out;
}

function runLive(lines: string[]): Int8Array {
    const time = { isPlaying: true, currentSecond: 0, playbackRate: 1 };
    const detected = new Int8Array(targets.length);
    const rec = new RunRecorder((event, data) => lines.push(JSON.stringify({ t: 0, event, ...data })));
    rec.start(header);
    const pipe = new NoteFramePipeline({
        targets, notesDetected: detected, time, latency: () => header.latency,
        config: header.config, scorer: header.scorer,
    });
    for (const f of stream(0.1)) {
        time.currentSecond = f.sec;
        rec.frame({ sec: f.sec, playing: true, rate: 1 }, f.notes);
        pipe.feed(f.notes);
    }
    rec.end(detected);
    return detected;
}

test('a recorded run replays to the same hits as the live run', () => {
    const lines: string[] = [];
    const live = runLive(lines);
    const liveHits = [...live].filter(v => v === 1).length;
    assert.ok(liveHits >= 4, 'live run should score repeats and the chord');
    const [run] = parseRuns(lines.join('\n'));
    const r = replayRun(run);
    assert.equal(r.matchesLive, true);
    assert.equal(r.hits, liveHits);
    assert.deepEqual(r.hitIndices, [...live].flatMap((v, i) => v === 1 ? [i] : []));
});

test('replay tolerates a truncated last line', () => {
    const lines: string[] = [];
    runLive(lines);
    const text = lines.join('\n') + '\n{"event":"frame","sec":9,';
    assert.equal(parseRuns(text).length, 1);
});

test('retuning offset changes the result without replaying', () => {
    const lines: string[] = [];
    runLive(lines);
    const [run] = parseRuns(lines.join('\n'));
    const base = replayRun(run);
    // A 0.3 s offset shifts every stamp outside the ±150 ms window.
    const off = replayRun(run, { devOffset: 0.3 });
    assert.ok(off.hits < base.hits);
});

test('reset mid-run clears results like a seek', () => {
    const lines: string[] = [];
    runLive(lines);
    const [run] = parseRuns(lines.join('\n'));
    run.events.push({ kind: 'reset' });
    assert.equal(replayRun(run).hits, 0);
});

test('unknown source is rejected', () => {
    const lines: string[] = [];
    runLive(lines);
    const [run] = parseRuns(lines.join('\n'));
    assert.throws(() => replayRun({ ...run, source: 'nope' }), /No onset stage/);
});

test('delta stats and formatted report', () => {
    const s = deltaStats([-0.02, 0.0, 0.02, 0.04])!;
    assert.equal(s.n, 4);
    assert.ok(Math.abs(s.meanMs - 10) < 1e-9);
    assert.ok(Math.abs(s.medianMs - 10) < 1e-9);
    assert.equal(deltaStats([]), null);
    const lines: string[] = [];
    runLive(lines);
    const out = formatResult(replayRun(parseRuns(lines.join('\n'))[0]));
    assert.match(out, /hit rate/);
    assert.match(out, /matches live run: yes/);
});
