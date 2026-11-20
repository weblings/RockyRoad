// Dev-only page for checking whether a USB MIDI keyboard is visible to the browser (Quest included).
// Open midi-test.html?debug=midi to also stream events to .debug/<session>.jsonl on the PC.
import { debugLog, debugOn } from './shared/DebugLog';

const LOWEST_KEY = 21; // A0 on an 88-key keyboard
const HIGHEST_KEY = 108; // C8
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const HAS_MIDI = 'requestMIDIAccess' in navigator;

// Matches the app's XR mode. Passthrough keeps the keyboard in view, with a green tint per key press.
const XR_MODE: XRSessionMode = 'immersive-ar';
const HEARTBEAT_MS = 5000;
// ?probe=mic makes the XR pinch request the mic instead, to compare how the prompt behaves in a session.
const PROBE_MIC = new URLSearchParams(location.search).get('probe') === 'mic';
const KEY_FLASH_MS = 150; // keeps very short presses visible

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const statusEl = $('status');
const lastEl = $('last');
const devicesEl = $('devices');
const logEl = $('log');
const xrButton = $('xr') as HTMLButtonElement;
const permEl = $('perm');

let access: MIDIAccess | null = null;
let xrSession: XRSession | null = null;
let noteOns = 0;
let flashUntil = 0;
const heldKeys = new Set<number>();

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

type RequestPhase = 'idle' | 'requested' | 'granted' | 'failed';
let queriedState = 'unknown';
let phase: RequestPhase = 'idle';
let phaseDetail = '';
const PENDING_HINT_MS = 1500; // a request still open after this probably has a prompt on screen

function renderPerm(): void {
    permEl.textContent = `Permission (query): ${queriedState}
Request: ${phase}${phaseDetail ? ` (${phaseDetail})` : ''}`;
}

function setPhase(next: RequestPhase, detail = ''): void {
    phase = next;
    phaseDetail = detail;
    renderPerm();
}

function logPermission(when: string): void {
    navigator.permissions.query({ name: 'midi' as PermissionName })
        .then(p => {
            queriedState = p.state;
            renderPerm();
            debugLog('midi', 'permission', { when, state: p.state, inXR: xrSession !== null });
        })
        .catch(err => {
            queriedState = 'unavailable';
            renderPerm();
            debugLog('midi', 'permission', { when, state: 'unavailable', error: String(err) });
        });
}

// Live updates when the user changes the grant mid-session, e.g. via browser settings.
function watchPermission(): void {
    navigator.permissions.query({ name: 'midi' as PermissionName })
        .then(p => {
            p.onchange = () => {
                queriedState = p.state;
                renderPerm();
                log(`permission changed -> ${p.state}`);
                debugLog('midi', 'permission-change', { state: p.state, inXR: xrSession !== null });
            };
        })
        .catch(() => { /* logPermission already records unavailability */ });
}

function onMessage(input: MIDIInput, e: MIDIMessageEvent): void {
    if (!e.data) return;
    const msg = decode(e.data);
    if (msg.kind === 'noteon') {
        heldKeys.add(msg.note as number);
        noteOns++;
        flashUntil = performance.now() + KEY_FLASH_MS;
    } else if (msg.kind === 'noteoff') {
        heldKeys.delete(msg.note as number);
    }
    if (msg.kind === 'noteon' || msg.kind === 'noteoff') {
        lastEl.textContent = `${msg.kind === 'noteon' ? 'DOWN' : 'UP'} ${msg.name}  note ${msg.note}  key ${msg.keyIndex}  vel ${msg.velocity}`;
    }
    log(`${input.name}: ${JSON.stringify(msg)}`);
    debugLog('midi', 'message', { input: input.name, inXR: xrSession !== null, ...msg });
}

function listPorts(access: MIDIAccess): void {
    const row = (p: MIDIPort) => `  ${p.name ?? '?'} (${p.manufacturer ?? '?'}) ${p.state}/${p.connection}`;
    const inputs = [...access.inputs.values()];
    const outputs = [...access.outputs.values()];
    devicesEl.textContent = `Inputs (${inputs.length}):\n${inputs.map(row).join('\n') || '  none'}\n`
        + `Outputs (${outputs.length}):\n${outputs.map(row).join('\n') || '  none'}`;
    setStatus(inputs.length ? `${inputs.length} MIDI input(s) found, press keys` : 'Access granted, but no MIDI inputs found',
        inputs.length ? 'ok' : 'bad');
    debugLog('midi', 'ports', {
        inputs: inputs.map(p => p.name), outputs: outputs.map(p => p.name),
        inputStates: inputs.map(p => `${p.state}/${p.connection}`), inXR: xrSession !== null,
    });
}

async function requestAccess(): Promise<void> {
    if (!HAS_MIDI) {
        setStatus('Web MIDI is not available in this browser', 'bad');
        debugLog('midi', 'unsupported', { userAgent: navigator.userAgent });
        return;
    }
    if (phase === 'requested') return;
    setStatus('Requesting access, accept the browser prompt if one appears');
    const t0 = performance.now();
    const elapsed = () => Math.round(performance.now() - t0);
    setPhase('requested');
    debugLog('midi', 'access-requested', { permBefore: queriedState, inXR: xrSession !== null });
    const pendingTimer = window.setTimeout(() => {
        debugLog('midi', 'access-pending', { ms: elapsed(), permNow: queriedState });
        log(`request still pending after ${elapsed()} ms (prompt likely showing)`);
    }, PENDING_HINT_MS);
    try {
        const midi = await navigator.requestMIDIAccess();
        window.clearTimeout(pendingTimer);
        access = midi;
        setPhase('granted', `${elapsed()} ms`);
        debugLog('midi', 'access-granted', { ms: elapsed(), inXR: xrSession !== null });
        logPermission('access-granted');
        const attach = () => midi.inputs.forEach(input => { input.onmidimessage = e => onMessage(input, e); });
        attach();
        listPorts(midi);
        midi.onstatechange = e => {
            const port = e.port;
            log(`state: ${port?.type} ${port?.name} -> ${port?.state}/${port?.connection}`);
            debugLog('midi', 'statechange', { name: port?.name, type: port?.type, state: port?.state, inXR: xrSession !== null });
            if (port?.state === 'disconnected') heldKeys.clear();
            attach();
            listPorts(midi);
        };
    } catch (err) {
        window.clearTimeout(pendingTimer);
        const e = err as DOMException;
        // A near-instant failure suggests a stored denial rather than a dismissed prompt.
        setPhase('failed', `${e.name} after ${elapsed()} ms`);
        setStatus(`MIDI access refused: ${e.name}: ${e.message}`, 'bad');
        debugLog('midi', 'access-failed', { name: e.name, message: e.message, ms: elapsed(), inXR: xrSession !== null });
        logPermission('access-failed');
    }
}

async function requestMic(): Promise<void> {
    const t0 = performance.now();
    const elapsed = () => Math.round(performance.now() - t0);
    const state = async () => {
        try { return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state; } catch { return 'unavailable'; }
    };
    debugLog('midi', 'mic-requested', { permBefore: await state(), inXR: xrSession !== null });
    const pendingTimer = window.setTimeout(() => debugLog('midi', 'mic-pending', { ms: elapsed() }), PENDING_HINT_MS);
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        debugLog('midi', 'mic-granted', { ms: elapsed(), inXR: xrSession !== null, permAfter: await state() });
    } catch (err) {
        const e = err as DOMException;
        debugLog('midi', 'mic-failed', { name: e.name, message: e.message, ms: elapsed(), inXR: xrSession !== null, permAfter: await state() });
    } finally {
        window.clearTimeout(pendingTimer);
    }
}

async function enterXR(): Promise<void> {
    try {
        const session = await navigator.xr!.requestSession(XR_MODE);
        const gl = document.createElement('canvas').getContext('webgl2', { xrCompatible: true });
        if (!gl) throw new Error('WebGL2 unavailable');
        session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
        xrSession = session;
        const startNoteOns = noteOns;
        let frames = 0;
        let lastBeat = performance.now();
        debugLog('midi', 'xr-start', { mode: XR_MODE, hasAccess: access !== null });
        logPermission('xr-start');

        // Pinch or trigger inside the session requests access, to test a first request in XR.
        session.addEventListener('select', () => {
            debugLog('midi', 'xr-select', { probe: PROBE_MIC ? 'mic' : 'midi', phase, permission: queriedState });
            if (PROBE_MIC) void requestMic();
            else void requestAccess();
        });
        session.addEventListener('visibilitychange', () => {
            debugLog('midi', 'xr-visibility', { state: session.visibilityState });
        });
        session.addEventListener('end', () => {
            debugLog('midi', 'xr-end', { noteOns: noteOns - startNoteOns, frames });
            xrSession = null;
        });

        const onFrame: XRFrameRequestCallback = () => {
            session.requestAnimationFrame(onFrame);
            const now = performance.now();
            const lit = now < flashUntil || heldKeys.size > 0;
            gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer!.framebuffer);
            gl.clearColor(0, lit ? 0.5 : 0, 0, lit ? 0.5 : 0); // premultiplied green, or clear
            gl.clear(gl.COLOR_BUFFER_BIT);
            frames++;
            if (now - lastBeat >= HEARTBEAT_MS) {
                lastBeat = now;
                debugLog('midi', 'xr-heartbeat', {
                    frames, noteOns: noteOns - startNoteOns, inputs: access?.inputs.size ?? 0,
                    page: document.visibilityState,
                });
            }
        };
        session.requestAnimationFrame(onFrame);
    } catch (err) {
        setStatus(`Could not enter XR: ${String(err)}`, 'bad');
        debugLog('midi', 'xr-failed', { error: String(err) });
    }
}

$('request').addEventListener('click', () => { void requestAccess(); });
xrButton.addEventListener('click', () => { void enterXR(); });
$('clear').addEventListener('click', () => { logEl.textContent = ''; lastEl.textContent = ''; });

log(`secure context: ${window.isSecureContext}, PC logging: ${debugOn('midi') ? 'on' : 'off (add ?debug=midi)'}`);
debugLog('midi', 'page-load', { secure: window.isSecureContext, userAgent: navigator.userAgent });
logPermission('page-load');
watchPermission();
renderPerm();
document.addEventListener('visibilitychange', () => {
    debugLog('midi', 'page-visibility', { state: document.visibilityState, inXR: xrSession !== null });
});
navigator.xr?.isSessionSupported(XR_MODE)
    .then(supported => {
        xrButton.disabled = !supported;
        debugLog('midi', 'xr-supported', { mode: XR_MODE, supported });
    })
    .catch(err => debugLog('midi', 'xr-supported', { mode: XR_MODE, error: String(err) }));
setStatus(HAS_MIDI ? 'Web MIDI API present, press Request MIDI access' : 'Web MIDI is not available in this browser',
    HAS_MIDI ? '' : 'bad');
