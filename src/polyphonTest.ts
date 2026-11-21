// Dev-only page to measure Polyphon (PitchPlease) cpuLoad, kernel and latency on Quest Browser.
// Open polyphon-test.html?debug=polyphon to stream stats to .debug/<session>.jsonl on the PC.
import { create, type Detector } from '@markusstrasser/pitchplease';
import { debugLog } from './shared/DebugLog';

const MODELS = ['fast', 'piano', 'voice', 'fft'] as const;
type ModelId = typeof MODELS[number];
const STATS_MS = 2000;
// Worklet, wasm and model files are served straight from the package, since Vite bundling breaks its relative URLs.
const ASSET_BASE = '/node_modules/@markusstrasser/pitchplease/';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const statusEl = $('status');
const notesEl = $('notes');
const statsEl = $('stats');
const logEl = $('log');
const startBtn = $('start') as HTMLButtonElement;
const stopBtn = $('stop') as HTMLButtonElement;
const modelsEl = $('models');

let detector: Detector | null = null;
let model: ModelId = 'fast';
let frames = 0;
let lastNames = '';
let lastEmitGap = 0;
const modelButtons = new Map<ModelId, HTMLButtonElement>();

function log(line: string): void {
    logEl.textContent = `${line}\n${logEl.textContent ?? ''}`.slice(0, 6000);
}

function setStatus(text: string, kind: 'ok' | 'bad' | '' = ''): void {
    statusEl.textContent = text;
    statusEl.className = kind;
}

function markModel(): void {
    for (const [id, b] of modelButtons) b.className = id === model ? 'active' : '';
}

async function start(): Promise<void> {
    startBtn.disabled = true;
    setStatus('Starting...');
    const t0 = performance.now();
    detector = create({
        model,
        assetBaseUrl: ASSET_BASE,
        onNotes: (notes, frame) => {
            frames++;
            lastEmitGap = (frame as { emitTime: number; time: number }).emitTime - (frame as { time: number }).time;
            const names = notes.map(n => n.name).join(' ');
            // Probability per note shows how close a flickering note sits to the on threshold.
            const withProb = notes.map(n => `${n.name}:${n.prob.toFixed(2)}`).join(' ');
            notesEl.textContent = withProb || '-';
            if (names !== lastNames) {
                lastNames = names;
                debugLog('polyphon', 'notes', { names, probs: notes.map(n => Math.round(n.prob * 100) / 100), model });
            }
        },
        onError: err => {
            log(`error: ${String(err)}`);
            debugLog('polyphon', 'error', { message: String(err), model });
        },
    });
    const ok = await detector.start();
    const ms = Math.round(performance.now() - t0);
    setStatus(ok ? `Listening (${model}), started in ${ms} ms` : 'Start failed', ok ? 'ok' : 'bad');
    debugLog('polyphon', 'start', { ok, model, ms });
    stopBtn.disabled = !ok;
    startBtn.disabled = ok;
}

function stop(): void {
    detector?.stop();
    detector = null;
    setStatus('Stopped');
    debugLog('polyphon', 'stop', { model });
    startBtn.disabled = false;
    stopBtn.disabled = true;
}

async function pick(id: ModelId): Promise<void> {
    model = id;
    markModel();
    if (!detector) return;
    const t0 = performance.now();
    const now = await detector.setModel(id);
    debugLog('polyphon', 'set-model', { requested: id, now, ms: Math.round(performance.now() - t0) });
    setStatus(`Listening (${now})`, 'ok');
}

for (const id of MODELS) {
    const b = document.createElement('button');
    b.textContent = id;
    b.addEventListener('click', () => { void pick(id); });
    modelsEl.appendChild(b);
    modelButtons.set(id, b);
}
markModel();
startBtn.addEventListener('click', () => { void start(); });
stopBtn.addEventListener('click', stop);

setInterval(() => {
    if (!detector) return;
    const s = detector.stats;
    statsEl.textContent = `model ${s.model}  kernel ${s.kernel}\ncpuLoad ${s.cpuLoad.toFixed(2)}  fps ${s.framesPerSecond.toFixed(0)}\nsampleRate ${s.sampleRate}  detector latency ${(lastEmitGap * 1000).toFixed(0)} ms`;
    debugLog('polyphon', 'stats', { ...s, frames, emitGapMs: Math.round(lastEmitGap * 1000) });
}, STATS_MS);
