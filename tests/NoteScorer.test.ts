import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoteScorer } from '../src/shared/NoteScorer';
import { NoteDetector } from './legacy/NoteDetector';
import { hzToMidi, type NoteObservation, type NoteTarget } from '../src/shared/NoteInput';
import type { SongNote } from '../src/shared/SongFormat';
import type { SongIndexPart } from '../src/shared/SongIndex';

const obs = (time: number, midi: number): NoteObservation => ({ time, midi, confidence: 1 });

function setup(targets: NoteTarget[], opts = {}, grace: number | null = null) {
    let now = 0;
    const detected = new Int8Array(targets.length);
    const scorer = new NoteScorer(targets, detected, () => now, () => grace, opts);
    return { scorer, detected, at: (t: number) => { now = t; } };
}

test('chord: each observation claims its own target', () => {
    const { scorer, detected, at } = setup(
        [{ time: 1, midi: 60 }, { time: 1, midi: 64 }, { time: 1, midi: 67 }], { tolerance: 0 });
    at(1);
    scorer.tick([obs(1, 60), obs(1, 67)]);
    assert.deepEqual([...detected], [1, 0, 1]);
    at(1.2);
    scorer.tick([]);
    assert.deepEqual([...detected], [1, -1, 1]);
});

test('repeated pitch: one observation hits one target only', () => {
    const { scorer, detected, at } = setup(
        [{ time: 1, midi: 60 }, { time: 1.1, midi: 60 }], { tolerance: 0 });
    at(1.05);
    scorer.tick([obs(1.05, 60)]);
    assert.deepEqual([...detected], [1, 0]);
    scorer.tick([obs(1.06, 60)]);
    assert.deepEqual([...detected], [1, 1]);
});

test('window edges and tolerance', () => {
    const { scorer, detected, at } = setup([{ time: 1, midi: 60 }, { time: 5, midi: 60 }]);
    at(1.2);
    scorer.tick([obs(1.2, 60)]);              // outside +-150 ms
    assert.equal(detected[0], -1);
    at(5);
    scorer.tick([obs(5, 60.6)]);              // outside 0.5 semitone
    assert.equal(detected[1], 0);
    scorer.tick([obs(5, 60.4)]);
    assert.equal(detected[1], 1);
});

test('octave fold', () => {
    const off = setup([{ time: 1, midi: 60 }]);
    off.at(1); off.scorer.tick([obs(1, 72)]);
    assert.equal(off.detected[0], 0);
    const on = setup([{ time: 1, midi: 60 }], { octaveFold: true });
    on.at(1); on.scorer.tick([obs(1, 72), obs(1, 48)]);
    assert.equal(on.detected[0], 1);
});

test('grace period skips hits and misses', () => {
    const { scorer, detected, at } = setup([{ time: 1, midi: 60 }, { time: 3, midi: 62 }], {}, 2);
    at(1); scorer.tick([obs(1, 60)]);
    assert.equal(detected[0], 0);
    at(2.5); scorer.tick([]);
    assert.equal(detected[0], 0);
    at(3.2); scorer.tick([]);
    assert.equal(detected[1], -1);
});

test('reset clears results and rescans', () => {
    const { scorer, detected, at } = setup([{ time: 1, midi: 60 }]);
    at(2); scorer.tick([]);
    assert.equal(detected[0], -1);
    scorer.reset();
    assert.equal(detected[0], 0);
    at(1); scorer.tick([obs(1, 60)]);
    assert.equal(detected[0], 1);
});

test('parity with NoteDetector on the same mono frames', () => {
    // Standard 6-string guitar, MIDI = base + fret.
    const base = [40, 45, 50, 55, 59, 64];
    const picks = [[0, 3], [1, 2], [2, 0], [3, 2], [0, 3], [5, 1], [4, 0], [2, 2]];
    const notes = picks.map(([s, f], i) =>
        ({ TimeOffset: 0.5 * i + 1, String: s, Fret: f } as unknown as SongNote));
    const part = { tuningOffsets: [0, 0, 0, 0, 0, 0] } as unknown as SongIndexPart;
    const targets = notes.map((n, i) => ({ time: n.TimeOffset, midi: base[picks[i][0]] + picks[i][1] }));

    let now = 0;
    const a = new Int8Array(notes.length), b = new Int8Array(notes.length);
    const det = new NoteDetector(notes, part, () => now, a, () => 1.2);
    const scorer = new NoteScorer(targets, b, () => now, () => 1.2, { octaveFold: true });

    // Frames every 20 ms. Play notes 0-5 slightly late and sharp, skip 6, play 7 an octave up.
    const freq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    for (let step = 0; step <= 300; step++) {
        now = step * 0.02;
        let hz: number | null = null;
        for (let i = 0; i < targets.length; i++) {
            if (i === 6) continue;
            const m = targets[i].midi + (i === 7 ? 12 : 0) + (i % 2 ? 0.3 : -0.3);
            if (Math.abs(now - (targets[i].time + 0.05)) < 0.03) hz = freq(m);
        }
        det.tick(hz === null ? null : { frequency: hz, clarity: 1, rms: 0.1 });
        scorer.tick(hz === null ? [] : [obs(now, hzToMidi(hz))]);
    }
    assert.deepEqual([...b], [...a]);
    assert.ok(a.includes(1) && a.includes(-1), 'sequence should contain hits and misses');
});
