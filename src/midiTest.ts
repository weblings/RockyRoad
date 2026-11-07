// Dev-only page for checking whether a USB MIDI keyboard is visible to the browser (Quest included).
// Open midi-test.html?debug=midi to also stream events to .debug/<session>.jsonl on the PC.
import { debugLog, debugOn } from './shared/DebugLog';

const LOWEST_KEY = 21; // A0 on an 88-key keyboard
const HIGHEST_KEY = 108; // C8
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const HAS_MIDI = 'requestMIDIAccess' in navigator;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const statusEl = $('status');
const lastEl = $('last');
const devicesEl = $('devices');
const logEl = $('log');

function setStatus(text: string, kind: 'ok' | 'bad' | '' = ''): void {
    statusEl.textContent = text;
    statusEl.className = kind;
}

function log(line: string): void {
    logEl.textContent = `${line}\n${logEl.textContent ?? ''}`.slice(0, 8000);
}

function noteName(note: number): string {
    return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function decode(data: Uint8Array): Record<string, unknown> {
    const [status = 0, d1 = 0, d2 = 0] = data;
    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    const bytes = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    if (type === 0x90 || type === 0x80) {
        // Note On with velocity 0 is a release, many keyboards never send 0x80.
        const down = type === 0x90 && d2 > 0;
        return {
            kind: down ? 'noteon' : 'noteoff', bytes, channel, note: d1, name: noteName(d1), velocity: d2,
            keyIndex: d1 - LOWEST_KEY, onKeyboard: d1 >= LOWEST_KEY && d1 <= HIGHEST_KEY,
        };
    }
    if (type === 0xb0) return { kind: d1 === 64 ? 'sustain' : 'cc', bytes, channel, controller: d1, value: d2 };
    return { kind: 'other', bytes, status };
}

function onMessage(input: MIDIInput, e: MIDIMessageEvent): void {
    if (!e.data) return;
    const msg = decode(e.data);
    if (msg.kind === 'noteon' || msg.kind === 'noteoff') {
        lastEl.textContent = `${msg.kind === 'noteon' ? 'DOWN' : 'UP'} ${msg.name}  note ${msg.note}  key ${msg.keyIndex}  vel ${msg.velocity}`;
    }
    log(`${input.name}: ${JSON.stringify(msg)}`);
    debugLog('midi', 'message', { input: input.name, ...msg });
}

function listPorts(access: MIDIAccess): void {
    const row = (p: MIDIPort) => `  ${p.name ?? '?'} (${p.manufacturer ?? '?'}) ${p.state}/${p.connection}`;
    const inputs = [...access.inputs.values()];
    const outputs = [...access.outputs.values()];
    devicesEl.textContent = `Inputs (${inputs.length}):\n${inputs.map(row).join('\n') || '  none'}\n`
        + `Outputs (${outputs.length}):\n${outputs.map(row).join('\n') || '  none'}`;
    setStatus(inputs.length ? `${inputs.length} MIDI input(s) found, press keys` : 'Access granted, but no MIDI inputs found',
        inputs.length ? 'ok' : 'bad');
    debugLog('midi', 'ports', { inputs: inputs.map(p => p.name), outputs: outputs.map(p => p.name) });
}

async function requestAccess(): Promise<void> {
    if (!HAS_MIDI) {
        setStatus('Web MIDI is not available in this browser', 'bad');
        debugLog('midi', 'unsupported', { userAgent: navigator.userAgent });
        return;
    }
    setStatus('Requesting access, accept the browser prompt if one appears');
    try {
        const access = await navigator.requestMIDIAccess();
        const attach = () => access.inputs.forEach(input => { input.onmidimessage = e => onMessage(input, e); });
        attach();
        listPorts(access);
        access.onstatechange = e => {
            const port = e.port;
            log(`state: ${port?.type} ${port?.name} -> ${port?.state}/${port?.connection}`);
            debugLog('midi', 'statechange', { name: port?.name, type: port?.type, state: port?.state });
            attach();
            listPorts(access);
        };
    } catch (err) {
        setStatus(`MIDI access refused: ${String(err)}`, 'bad');
        debugLog('midi', 'access-failed', { error: String(err) });
    }
}

$('request').addEventListener('click', () => { void requestAccess(); });
$('clear').addEventListener('click', () => { logEl.textContent = ''; lastEl.textContent = ''; });

log(`secure context: ${window.isSecureContext}, PC logging: ${debugOn('midi') ? 'on' : 'off (add ?debug=midi)'}`);
debugLog('midi', 'page-load', { secure: window.isSecureContext, userAgent: navigator.userAgent });
setStatus(HAS_MIDI ? 'Web MIDI API present, press Request MIDI access' : 'Web MIDI is not available in this browser',
    HAS_MIDI ? '' : 'bad');
