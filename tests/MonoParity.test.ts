import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NoteDetector } from './legacy/NoteDetector';
import { NoteScorer } from '../src/shared/NoteScorer';
import { MONO_SCORER_OPTIONS, monoObservations, stringedTargets } from '../src/shared/MonoNoteAdapter';
import { parseMonoRuns, type RecordedMonoRun } from '../src/shared/MonoRunRecording';
import type { SongNote } from '../src/shared/SongFormat';
import type { SongIndexPart } from '../src/shared/SongIndex';

// Two real guitar takes: Home on the Range (single notes) and Loch Lomond (chords, played badly).
const runs = parseMonoRuns(readFileSync(new URL('./fixtures/mono-guitar-runs.jsonl', import.meta.url), 'utf8'));

function replayBoth(run: RecordedMonoRun) {
    const notes = run.notes.map(n => ({ TimeOffset: n.time, String: n.string, Fret: n.fret }) as unknown as SongNote);
    const part = { tuningOffsets: run.tuningOffsets } as unknown as SongIndexPart;
    let now = 0;
    let grace: number | null = null;
    const oldOut = new Int8Array(notes.length);
    const newOut = new Int8Array(notes.length);
    const det = new NoteDetector(notes, part, () => now, oldOut, () => grace);
    const scorer = new NoteScorer(
        stringedTargets(notes, run.tuningOffsets), newOut, () => now, () => grace, MONO_SCORER_OPTIONS);
    for (const e of run.events) {
        if (e.kind === 'reset') { det.reset(); scorer.reset(); continue; }
        now = e.sec;
        grace = e.grace;
        const result = e.hz === null ? null : { frequency: e.hz, clarity: 1, rms: 0.1 };
        det.tick(result);
        scorer.tick(monoObservations(result, e.sec));
    }
    return { oldOut, newOut };
}

test('fixture holds two recorded guitar runs', () => {
    assert.equal(runs.length, 2);
    assert.ok(runs.every(r => r.events.length > 1000));
});

for (const [i, name] of ['Home on the Range', 'Loch Lomond'].entries()) {
    test(`recorded ${name}: NoteScorer matches NoteDetector`, () => {
        const { oldOut, newOut } = replayBoth(runs[i]);
        assert.deepEqual([...newOut], [...oldOut]);
        assert.ok(oldOut.includes(1) && oldOut.includes(-1), 'run should contain hits and misses');
    });
}

test('recorded run matches the live hits it logged', () => {
    const run = runs.find(r => r.liveHits !== null)!;
    const { newOut } = replayBoth(run);
    const hits = [...newOut].flatMap((v, i) => (v === 1 ? [i] : []));
    assert.deepEqual(hits, run.liveHits);
});

test('targets follow tuningOffsets', () => {
    const notes = [{ TimeOffset: 1, String: 0, Fret: 0 }, { TimeOffset: 2, String: 5, Fret: 3 }];
    assert.deepEqual(stringedTargets(notes, [0, 0, 0, 0, 0, 0]), [{ time: 1, midi: 40 }, { time: 2, midi: 67 }]);
    assert.deepEqual(stringedTargets(notes, [-2, 0, 0, 0, 0, 0]), [{ time: 1, midi: 38 }, { time: 2, midi: 67 }]);
});

test('mono observation uses fractional MIDI and none when silent', () => {
    assert.deepEqual(monoObservations(null, 1), []);
    const [o] = monoObservations({ frequency: 440, clarity: 0.9, rms: 0.1 }, 2);
    assert.equal(o.midi, 69);
    assert.equal(o.time, 2);
});

test('maxOctaves limits the fold', () => {
    const run = (midi: number, maxOctaves: number) => {
        const out = new Int8Array(1);
        const s = new NoteScorer([{ time: 1, midi: 55 }], out, () => 1, () => null, { octaveFold: true, maxOctaves });
        s.tick([{ time: 1, midi, confidence: 1 }]);
        return out[0];
    };
    assert.equal(run(43, 1), 1);   // one octave down
    assert.equal(run(31, 1), 0);   // two octaves down
    assert.equal(run(31, Infinity), 1);
});
