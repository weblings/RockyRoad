// Dev-only page to try poly-peach's Chromagram (the only reusable part of the package) on live mic audio.
// Open poly-peach-test.html?debug=polypeach to stream events to .debug/<session>.jsonl on the PC.
import { Chromagram } from 'poly-peach/dist/chromagram';
import { debugLog } from './shared/DebugLog';

const FIRST_MIDI = 48; // C3, the Chromagram's reference note. It covers 4 octaves, C3 to B6.
const FRAME = 1024;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const params = new URLSearchParams(location.search);
const REL = Number(params.get('rel') ?? 0.5); // a note counts when its level is at least this share of the loudest
const FLOOR = Number(params.get('floor') ?? 0.15); // and above this level (float audio scale, room noise sits near 0.09)
const INTERVAL = Number(params.get('interval') ?? 1024); // samples between chroma updates (library default 4096)
const STATS_MS = 2000;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const statusEl = $('status');
const notesEl = $('notes');
const statsEl = $('stats');
const logEl = $('log');
const startBtn = $('start') as HTMLButtonElement;
const stopBtn = $('stop') as HTMLButtonElement;

let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let proc: ScriptProcessorNode | null = null;
let frames = 0;
let updates = 0;
let lastNames = '';
let lastMax = 0;
let cpuMs = 0;

function setStatus(text: string, kind: 'ok' | 'bad' | '' = ''): void {
    statusEl.textContent = text;
    statusEl.className = kind;
}

function name(midi: number): string {
    return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

async function start(): Promise<void> {
    startBtn.disabled = true;
    setStatus('Requesting mic... (answer the browser prompt)');
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false,
        });
    } catch (err) {
        setStatus(`Mic failed: ${String(err)}`, 'bad');
        startBtn.disabled = false;
        return;
    }
    ctx = new AudioContext();
    // The library hardcodes 44100 in its own demo, so the real rate is passed to keep the bins aligned.
    const chroma = new Chromagram(FRAME, ctx.sampleRate);
    chroma.setChromaCalculationInterval(INTERVAL);
    proc = ctx.createScriptProcessor(FRAME, 1, 1);
    ctx.createMediaStreamSource(stream).connect(proc);
    proc.connect(ctx.destination);
    proc.onaudioprocess = e => {
        const t0 = performance.now();
        frames++;
        chroma.processAudioFrame(e.inputBuffer.getChannelData(0) as unknown as number[]);
        if (chroma.isReady()) {
            updates++;
            const pitches = chroma.getPitches() as number[];
            const max = Math.max(...pitches);
            lastMax = max;
            const on: string[] = [];
            const levels: number[] = [];
            pitches.forEach((v, i) => {
                if (v >= FLOOR && v >= REL * max) { on.push(name(FIRST_MIDI + i)); levels.push(Math.round(v * 100) / 100); }
            });
            const names = on.join(' ');
            // Level is the raw spectrum magnitude, shown with its share of the loudest note.
            notesEl.textContent = on.map((n, k) => `${n}:${levels[k]}(${Math.round(100 * levels[k]! / max)}%)`).join(' ') || '-';
            if (names !== lastNames) {
                lastNames = names;
                debugLog('polypeach', 'notes', { names, levels, max: Math.round(max * 100) / 100 });
            }
        }
        cpuMs += performance.now() - t0;
    };
    setStatus(`Listening, ${ctx.sampleRate} Hz, update every ${INTERVAL} samples`, 'ok');
    debugLog('polypeach', 'start', { sampleRate: ctx.sampleRate, interval: INTERVAL, rel: REL, floor: FLOOR });
    stopBtn.disabled = false;
}

function stop(): void {
    if (proc) proc.onaudioprocess = null;
    proc?.disconnect();
    stream?.getTracks().forEach(t => t.stop());
    void ctx?.close();
    proc = null; stream = null; ctx = null;
    setStatus('Stopped');
    debugLog('polypeach', 'stop');
    startBtn.disabled = false;
    stopBtn.disabled = true;
}

// Surfaces module and runtime errors on the page, since a Quest headset has no console.
window.addEventListener('error', e => setStatus(`Error: ${e.message}`, 'bad'));
window.addEventListener('unhandledrejection', e => setStatus(`Error: ${String(e.reason)}`, 'bad'));
setStatus('Ready, tap Start mic');
startBtn.addEventListener('click', () => { void start(); });
stopBtn.addEventListener('click', stop);

setInterval(() => {
    if (!ctx) return;
    // Main-thread cost: ScriptProcessor runs here, so this is share of real time, comparable to Polyphon's cpuLoad.
    const load = cpuMs / (STATS_MS);
    statsEl.textContent = `main-thread load ${load.toFixed(2)}  updates ${updates}  frames ${frames}\nloudest level ${lastMax.toFixed(1)}  rel ${REL}  floor ${FLOOR}  range C3-B6 only`;
    debugLog('polypeach', 'stats', { load, updates, frames, max: lastMax });
    cpuMs = 0;
}, STATS_MS);

void logEl;
