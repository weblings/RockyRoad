import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolyphonOnsets } from '../src/shared/PolyphonOnsets';
import { polyphonConfigFromParams, DEFAULT_POLYPHON_CONFIG } from '../src/shared/PolyphonConfig';
import { NoteScorer } from '../src/shared/NoteScorer';

const cfg = { minProb: 0, retriggerRise: 0.2 };
const n = (midi: number, prob = 0.9) => ({ midi, prob });
const midis = (r: { midi: number }[]) => r.map(x => x.midi);

test('a held note fires once on its rising edge', () => {
    const o = new PolyphonOnsets(cfg);
    assert.deepEqual(midis(o.process([n(60)], null)), [60]);
    assert.deepEqual(o.process([n(60)], null), []);
    assert.deepEqual(o.process([n(60)], null), []);
});

test('same pitch repeats after the note drops out', () => {
    const o = new PolyphonOnsets(cfg);
    o.process([n(64)], null);
    o.process([], null);
    assert.deepEqual(midis(o.process([n(64)], null)), [64]);
});

test('legato repeat fires on a probability rise without dropping out', () => {
    const o = new PolyphonOnsets(cfg);
    o.process([n(64, 0.9)], null);
    o.process([n(64, 0.5)], null);
    assert.deepEqual(midis(o.process([n(64, 0.85)], null)), [64]);
    assert.deepEqual(o.process([n(64, 0.9)], null), []);
});

test('retrigger disabled ignores probability rises', () => {
    const o = new PolyphonOnsets({ minProb: 0, retriggerRise: 0 });
    o.process([n(64, 0.9)], null);
    o.process([n(64, 0.4)], null);
    assert.deepEqual(o.process([n(64, 0.9)], null), []);
});

test('chord onsets arrive together', () => {
    const o = new PolyphonOnsets(cfg);
    assert.deepEqual(midis(o.process([n(60), n(64), n(67)], null)), [60, 64, 67]);
});

test('gating drops unexpected pitches', () => {
    const o = new PolyphonOnsets(cfg);
    assert.deepEqual(midis(o.process([n(60), n(61)], new Set([60]))), [60]);
});

test('minProb filters weak onsets', () => {
    const o = new PolyphonOnsets({ minProb: 0.8, retriggerRise: 0.2 });
    assert.deepEqual(o.process([n(60, 0.7)], null), []);
});

test('replayed frames score repeats and a chord', () => {
    const targets = [
        { time: 1.0, midi: 76 }, { time: 1.5, midi: 76 },
        { time: 2.0, midi: 60 }, { time: 2.0, midi: 64 }, { time: 2.0, midi: 67 },
    ];
    const detected = new Int8Array(targets.length);
    let now = 0;
    const scorer = new NoteScorer(targets, detected, () => now, () => null, { tolerance: 0 });
    const o = new PolyphonOnsets(cfg);
    const frames: [number, { midi: number; prob: number }[]][] = [
        [1.0, [n(76)]], [1.1, [n(76)]], [1.2, []],
        [1.5, [n(76)]], [1.6, []],
        [2.0, [n(60), n(64), n(67)]], [2.1, [n(60), n(64), n(67)]],
    ];
    for (const [t, notes] of frames) {
        now = t;
        const raw = o.process(notes, new Set(targets.filter(x => Math.abs(x.time - t) <= 0.25).map(x => x.midi)));
        scorer.tick(raw.map(r => ({ time: t, midi: r.midi, confidence: r.confidence })));
    }
    assert.deepEqual([...detected], [1, 1, 1, 1, 1]);
});

test('config params override defaults without code edits', () => {
    const c = polyphonConfigFromParams(new URLSearchParams('pp.model=fast&pp.on=0.5&pp.minProb=0.6&pp.gate=0.1'));
    assert.equal(c.model, 'fast');
    assert.deepEqual(c.threshold, { on: 0.5, off: 0.3 });
    assert.equal(c.minProb, 0.6);
    assert.equal(c.gateWindow, 0.1);
    assert.equal(polyphonConfigFromParams(new URLSearchParams('')).model, DEFAULT_POLYPHON_CONFIG.model);
});
