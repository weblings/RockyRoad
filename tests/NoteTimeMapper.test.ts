import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoteTimeMapper, HitDeltaLog, type TimeSource } from '../src/shared/NoteTimeMapper';
import { NoteScorer } from '../src/shared/NoteScorer';

const lat = { detector: 0.04, input: 0.01, delivery: 0.02, output: 0.03 };
const raw = [{ midi: 60, confidence: 1 }];

function player(over: Partial<TimeSource> = {}): TimeSource {
    return { isPlaying: true, currentSecond: 10, playbackRate: 1, ...over };
}

test('subtracts summed latency at rate 1', () => {
    const m = new NoteTimeMapper(player(), () => lat);
    assert.ok(Math.abs(m.map(raw)[0].time - 9.9) < 1e-9);
});

test('latency is scaled by playback rate', () => {
    const half = new NoteTimeMapper(player({ playbackRate: 0.5 }), () => lat);
    const dbl = new NoteTimeMapper(player({ playbackRate: 2 }), () => lat);
    assert.ok(Math.abs(half.map(raw)[0].time - 9.95) < 1e-9);
    assert.ok(Math.abs(dbl.map(raw)[0].time - 9.8) < 1e-9);
});

test('dev offset shifts the stamp', () => {
    const m = new NoteTimeMapper(player(), () => lat);
    m.devOffset = 0.05;
    assert.ok(Math.abs(m.map(raw)[0].time - 9.85) < 1e-9);
});

test('observations are dropped while paused so nothing is scored', () => {
    const detected = new Int8Array(1);
    const scorer = new NoteScorer([{ time: 10, midi: 60 }], detected, () => 10, () => null, { tolerance: 0 });
    const m = new NoteTimeMapper(player({ isPlaying: false }), () => lat);
    scorer.tick(m.map(raw));
    assert.deepEqual([...detected], [0]);
});

test('hit delta log records observed minus target', () => {
    const log = new HitDeltaLog();
    const detected = new Int8Array(1);
    const scorer = new NoteScorer([{ time: 10, midi: 60 }], detected, () => 10, () => null,
        { tolerance: 0, onHit: log.record });
    const m = new NoteTimeMapper(player(), () => lat);
    scorer.tick(m.map(raw));
    assert.equal(log.entries.length, 1);
    assert.ok(Math.abs(log.entries[0].delta + 0.1) < 1e-9);
});
