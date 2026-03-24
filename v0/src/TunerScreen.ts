import * as THREE from "three";
import type { App, IScreen } from "./App";
import type { ISongLibrary, SongIndexEntry, SongIndexPart } from "./SongIndex";
import { STANDARD_BASE_NOTES } from "./SongIndex";
import { loadSettings, saveSettings } from "./Settings";
import type { PitchDetector } from "./PitchDetector";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TunerContext =
    | 'song-flow'   // pre-scene → active scene (start song)
    | 'mid-song'    // settings panel during active scene → 3-2-1 → resume
    | 'menu';       // settings panel from library/pre-scene → return to previous screen

type TunerPhase =
    | { tag: 'correction'; stringIndex: number }
    | { tag: 'validation'; stringIndex: number; results: boolean[] }
    | { tag: 'complete' };

// Per-string colors, low string first (index 0 = thickest).
// Mirrors FretPlayerScene3D string palette.
const STRING_COLORS = ['#FF4444', '#FFA500', '#FFFF00', '#00CC00', '#4488FF', '#FF88FF'];

// Tolerance thresholds (cents)
const CORRECTION_PASS_CENTS = 10;
const VALIDATION_PASS_CENTS = 15;

// How long the string must stay in tune before advancing (ms)
const CORRECTION_DWELL_MS = 250;
const VALIDATION_DWELL_MS = 120;

// How long the ✓ stays before auto-advancing (ms)
const COMPLETE_HOLD_MS = 1000;

// ── TunerScreen ───────────────────────────────────────────────────────────────

export class TunerScreen implements IScreen {
    private app: App;
    private texture: THREE.Texture;
    private library: ISongLibrary;
    private entry: SongIndexEntry;
    private part: SongIndexPart;
    private context: TunerContext;
    private pausedAt: number;   // only relevant for mid-song

    // Current tuning offsets (may be overridden by dropdown)
    private offsets: number[];
    private targetMidis: number[];

    private phase: TunerPhase = { tag: 'correction', stringIndex: 0 };
    private detectedCents: number | null = null;
    private completeTimestamp = 0;

    // Per-string pass flash state (validation phase)
    private stringPassTime: number[] = [];

    private container: HTMLElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx2d: CanvasRenderingContext2D | null = null;
    private dpr = 1;
    private rafId = 0;

    private detector: PitchDetector | null = null;
    private invertStrings = false;
    private inputGain = 1;

    // Timestamp when the current string first entered the pass zone; -Infinity when outside.
    private dwellStart = -Infinity;
    // Last successfully detected frequency — shown as debug info on canvas.
    private lastDetectedHz: number | null = null;

    // Validation kick-back: timestamp when we entered the current validation string.
    // If the string hasn't passed within VALIDATION_TIMEOUT_MS, send back to correction.
    private validationStringEnteredAt = -Infinity;

    // Auto-boost: timestamp when we first saw signal-present-but-no-pitch in correction.
    // After AUTO_BOOST_DELAY_MS we double the gain to help weak strings (e.g. high e).
    private signalPresentNoDetectStart = -Infinity;
    private autoBoostActive = false;

    constructor(
        app: App,
        texture: THREE.Texture,
        library: ISongLibrary,
        entry: SongIndexEntry,
        part: SongIndexPart,
        context: TunerContext,
        pausedAt = 0,
    ) {
        this.app = app;
        this.texture = texture;
        this.library = library;
        this.entry = entry;
        this.part = part;
        this.context = context;
        this.pausedAt = pausedAt;

        this.offsets = part.tuningOffsets ?? [];
        this.targetMidis = this.computeTargetMidis(this.offsets);
        this.stringPassTime = new Array(this.offsets.length).fill(-Infinity);
    }

    async mount(container: HTMLElement): Promise<void> {
        this.container = container;
        const settings = loadSettings();
        const autoAdvance = settings.tunerAutoAdvance ?? true;
        this.invertStrings = settings.invertStrings;
        this.inputGain = settings.inputGain ?? 1;
        const skipLabel = this.contextExitLabel();

        container.innerHTML = `
            <div class="tuner-screen">

                <div class="tuner-bar">
                    <div class="tuner-bar-left">
                        <div class="tuner-title">Tune Up</div>
                        <div class="tuner-song">${esc(this.entry.songName)}</div>
                    </div>
                    <div class="tuner-bar-controls">
                        <label class="tuner-ctrl-label">Input
                            <select class="tuner-select" id="tuner-input-select">
                                <option value="">Default mic</option>
                            </select>
                        </label>
                        <label class="tuner-ctrl-label tuner-gain-label">Gain
                            <div class="tuner-gain-row">
                                <input type="range" class="tuner-gain-slider" id="tuner-gain"
                                    min="1" max="24" step="0.5" value="${this.inputGain}" />
                                <span id="tuner-gain-val">${this.inputGain}×</span>
                            </div>
                        </label>
                        <button class="tuner-btn" id="tuner-restart">Restart</button>
                        <button class="tuner-btn tuner-btn-skip" id="tuner-skip">Skip (I'm in tune)</button>
                        <button class="tuner-btn tuner-btn-exit" id="tuner-back">${esc(skipLabel)}</button>
                    </div>
                </div>

                <div class="tuner-body">
                    <div class="tuner-canvas-wrap">
                        <canvas id="tuner-canvas" width="960" height="540"></canvas>
                        <div class="tuner-complete-overlay hidden" id="tuner-complete">
                            <div class="tuner-check">✓</div>
                            <div class="tuner-in-tune">In tune!</div>
                            ${!autoAdvance ? `<button class="tuner-exit-btn" id="tuner-exit-complete">${esc(skipLabel)}</button>` : ''}
                        </div>
                        <div class="tuner-mic-wait hidden" id="tuner-mic-wait">Waiting for mic access…</div>
                    </div>
                </div>

            </div>`;

        this.canvas = container.querySelector<HTMLCanvasElement>('#tuner-canvas')!;
        this.ctx2d  = this.canvas.getContext('2d')!;

        // Scale canvas buffer by devicePixelRatio so strokes and text are crisp on
        // high-DPI screens. The CSS size stays as set by the HTML width/height attrs;
        // we just increase the internal resolution and pre-scale the context.
        this.dpr = window.devicePixelRatio || 1;
        const cssW = this.canvas.width;
        const cssH = this.canvas.height;
        this.canvas.style.width  = `${cssW}px`;
        this.canvas.style.height = `${cssH}px`;
        this.canvas.width  = Math.round(cssW * this.dpr);
        this.canvas.height = Math.round(cssH * this.dpr);
        this.ctx2d.scale(this.dpr, this.dpr);

        // Controls
        container.querySelector('#tuner-restart')?.addEventListener('click', () => this.restart());
        container.querySelector('#tuner-skip')?.addEventListener('click', () => this.exit());
        container.querySelector('#tuner-back')!.addEventListener('click', () => this.exit());
        container.querySelector('#tuner-exit-complete')?.addEventListener('click', () => this.exit());

        container.querySelector('#tuner-input-select')?.addEventListener('change', async e => {
            const deviceId = (e.target as HTMLSelectElement).value || undefined;
            await this.recreateDetector(deviceId);
        });

        container.querySelector('#tuner-gain')?.addEventListener('input', e => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            this.inputGain = val;
            const label = container.querySelector('#tuner-gain-val');
            if (label) label.textContent = `${val}×`;
            this.detector?.setGain(val);
            const s = loadSettings();
            s.inputGain = val;
            saveSettings(s);
        });

        // Start rAF loop
        this.rafId = requestAnimationFrame(t => this.tick(t));

        // Start pitch detection async — loop handles null until ready
        this.startDetector(container, this.inputGain);
    }

    unmount(): void {
        cancelAnimationFrame(this.rafId);
        this.detector?.destroy();
        this.detector = null;
        if (this.container) this.container.innerHTML = '';
        this.container = null;
        this.canvas = null;
        this.ctx2d = null;
    }

    // ── Pitch detector lifecycle ──────────────────────────────────────────────

    private async startDetector(container: HTMLElement, gain: number): Promise<void> {
        const micWait = container.querySelector<HTMLElement>('#tuner-mic-wait');
        if (micWait) micWait.classList.remove('hidden');
        try {
            const { PitchDetector } = await import('./PitchDetector');
            this.detector = await PitchDetector.create(undefined, gain);
            if (micWait) micWait.classList.add('hidden');
            await this.populateDeviceList(container);
        } catch {
            if (micWait) micWait.textContent = 'Mic access denied — use Skip.';
        }
    }

    private async recreateDetector(deviceId?: string): Promise<void> {
        this.detector?.destroy();
        this.detector = null;
        try {
            const { PitchDetector } = await import('./PitchDetector');
            this.detector = await PitchDetector.create(deviceId, this.inputGain);
        } catch { /* stay null */ }
    }

    private async populateDeviceList(container: HTMLElement): Promise<void> {
        const sel = container.querySelector<HTMLSelectElement>('#tuner-input-select');
        if (!sel) return;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputs = devices.filter(d => d.kind === 'audioinput');
            sel.innerHTML = '<option value="">Default mic</option>' +
                inputs.map(d => `<option value="${esc(d.deviceId)}">${esc(d.label || d.deviceId)}</option>`).join('');
        } catch { /* leave default */ }
    }

    // ── rAF tick ──────────────────────────────────────────────────────────────

    private tick(timestamp: number): void {
        if (!this.canvas || !this.ctx2d) return;

        const result = this.detector?.detect() ?? null;
        const n = this.offsets.length;

        // Auto-boost: if signal is present but pitch keeps going undetected in correction,
        // double the gain after 2 seconds to help weak-output strings (e.g. high e).
        if (this.phase.tag === 'correction' && !this.autoBoostActive) {
            const rms = this.detector?.lastRms ?? 0;
            if (result === null && rms > 0.02) {
                if (this.signalPresentNoDetectStart === -Infinity)
                    this.signalPresentNoDetectStart = timestamp;
                if (timestamp - this.signalPresentNoDetectStart >= 2000) {
                    this.detector?.setGain(Math.min(24, this.inputGain * 2));
                    this.autoBoostActive = true;
                }
            } else if (result !== null) {
                this.signalPresentNoDetectStart = -Infinity;
            }
        }

        if (this.phase.tag !== 'complete' && n > 0) {
            const currentString = this.phase.tag === 'correction'
                ? this.phase.stringIndex
                : this.phase.stringIndex;

            if (result) {
                this.lastDetectedHz = result.frequency;
                const cents = centDeviationWithOctaveCorrection(result.frequency, this.targetMidis[currentString]);
                this.detectedCents = cents;
                this.advanceStateMachine(cents, timestamp);
            } else {
                this.detectedCents = null;
            }
        }

        this.drawCanvas(timestamp);
        this.rafId = requestAnimationFrame(t => this.tick(t));

        // Handle auto-advance after complete hold
        if (this.phase.tag === 'complete' && this.completeTimestamp > 0) {
            const settings = loadSettings();
            const autoAdvance = settings.tunerAutoAdvance ?? true;
            if (autoAdvance && timestamp - this.completeTimestamp >= COMPLETE_HOLD_MS) {
                this.completeTimestamp = 0; // prevent re-trigger
                this.exit();
            }
        }
    }

    // ── State machine ─────────────────────────────────────────────────────────

    // If a validation string goes uncleared for this long, send back to correction.
    private static readonly VALIDATION_TIMEOUT_MS = 5000;

    private advanceStateMachine(cents: number, timestamp: number): void {
        const n = this.offsets.length;

        if (this.phase.tag === 'correction') {
            if (Math.abs(cents) <= CORRECTION_PASS_CENTS) {
                // Start dwell timer on first entry into the pass zone
                if (this.dwellStart === -Infinity) this.dwellStart = timestamp;

                // Advance only after holding in tune for the full dwell period
                if (timestamp - this.dwellStart >= CORRECTION_DWELL_MS) {
                    this.dwellStart = -Infinity;
                    // Restore gain if we had auto-boosted this string
                    this.signalPresentNoDetectStart = -Infinity;
                    this.autoBoostActive = false;
                    this.detector?.setGain(this.inputGain);

                    const next = this.phase.stringIndex + 1;
                    if (next >= n) {
                        this.validationStringEnteredAt = timestamp;
                        this.phase = { tag: 'validation', stringIndex: 0, results: new Array(n).fill(false) };
                    } else {
                        this.phase = { tag: 'correction', stringIndex: next };
                    }
                }
            } else {
                // Went out of tune — reset dwell
                this.dwellStart = -Infinity;
            }
        } else if (this.phase.tag === 'validation') {
            if (Math.abs(cents) <= VALIDATION_PASS_CENTS) {
                if (this.dwellStart === -Infinity) this.dwellStart = timestamp;

                if (timestamp - this.dwellStart >= VALIDATION_DWELL_MS) {
                    this.dwellStart = -Infinity;
                    this.stringPassTime[this.phase.stringIndex] = timestamp;
                    const results = [...this.phase.results];
                    results[this.phase.stringIndex] = true;
                    const next = this.phase.stringIndex + 1;
                    if (next >= n) {
                        this.phase = { tag: 'complete' };
                        this.completeTimestamp = timestamp;
                        this.showCompleteOverlay();
                    } else {
                        this.validationStringEnteredAt = timestamp;
                        this.phase = { tag: 'validation', stringIndex: next, results };
                    }
                }
            } else {
                this.dwellStart = -Infinity;
                // Only kick back to correction if the string has been failing for an
                // extended period — not on a single out-of-tune frame (which is common
                // when the detector briefly picks up an adjacent string during a strum).
                if (timestamp - this.validationStringEnteredAt >= TunerScreen.VALIDATION_TIMEOUT_MS) {
                    this.validationStringEnteredAt = -Infinity;
                    this.phase = { tag: 'correction', stringIndex: this.phase.stringIndex };
                }
            }
        }
    }

    private showCompleteOverlay(): void {
        this.container?.querySelector('#tuner-complete')?.classList.remove('hidden');
    }

    private restart(): void {
        this.phase = { tag: 'correction', stringIndex: 0 };
        this.detectedCents = null;
        this.dwellStart = -Infinity;
        this.stringPassTime.fill(-Infinity);
        this.validationStringEnteredAt = -Infinity;
        this.signalPresentNoDetectStart = -Infinity;
        this.autoBoostActive = false;
        this.detector?.setGain(this.inputGain);
        this.container?.querySelector('#tuner-complete')?.classList.add('hidden');
        this.completeTimestamp = 0;
    }

    // ── Exit ──────────────────────────────────────────────────────────────────

    private exit(): void {
        this.app.lastTuningKey = JSON.stringify(this.offsets);
        cancelAnimationFrame(this.rafId);

        switch (this.context) {
            case 'song-flow': {
                // Hand the live detector to ActiveSceneScreen — avoids a second
                // getUserMedia prompt and the gap while a new AudioContext opens.
                const det = this.detector;
                this.detector = null; // prevent unmount() from destroying it
                import('./ActiveSceneScreen').then(({ ActiveSceneScreen }) => {
                    this.app.navigate(new ActiveSceneScreen(
                        this.app, this.texture, this.library, this.entry, this.part, det,
                    ));
                });
                break;
            }
            case 'mid-song':
                this.app.resumeWithCountdown(this.pausedAt);
                break;
            case 'menu':
                // Navigate back — caller should pass a previousScreen; for now go to library
                import('./SongLibraryScreen').then(({ SongLibraryScreen }) => {
                    this.app.navigate(new SongLibraryScreen(this.app, this.texture, this.library));
                });
                break;
        }
    }

    private contextExitLabel(): string {
        switch (this.context) {
            case 'song-flow': return 'Play Song';
            case 'mid-song':  return 'Resume Song';
            case 'menu':      return 'Main Menu';
        }
    }

    // ── Canvas drawing ────────────────────────────────────────────────────────

    private drawCanvas(timestamp: number): void {
        const canvas = this.canvas!;
        const ctx = this.ctx2d!;
        const n = this.offsets.length;
        // Use CSS pixel dimensions — ctx is pre-scaled by dpr so all coords are in CSS space.
        const W = canvas.width / this.dpr;
        const H = canvas.height / this.dpr;

        ctx.clearRect(0, 0, W, H);

        if (n === 0) return;

        const marginTop    = 72;
        const marginBottom = 64;
        const marginLeft   = 104;
        const marginRight  = 36;
        const stringAreaH  = H - marginTop - marginBottom;
        const spacing      = n > 1 ? stringAreaH / (n - 1) : 0;

        // String Y positions — index 0 = lowest string.
        // Normal: lowest at bottom. Inverted: lowest at top (matches highway orientation).
        const stringY = (i: number) => this.invertStrings
            ? marginTop + i * spacing
            : marginTop + (n - 1 - i) * spacing;

        const currentString = this.phase.tag === 'correction' ? this.phase.stringIndex
                            : this.phase.tag === 'validation'  ? this.phase.stringIndex
                            : -1;
        const isValidation = this.phase.tag === 'validation';

        // Draw strings
        for (let i = 0; i < n; i++) {
            const y = stringY(i);
            const isActive = i === currentString;
            const color = STRING_COLORS[i] ?? '#ffffff';

            // Flash green on recent pass (validation phase)
            const timeSincePass = timestamp - this.stringPassTime[i];
            const justPassed = timeSincePass < 350;

            // Active string thicker and brighter; others dimmed
            ctx.globalAlpha = isActive ? 1.0 : (isValidation ? 0.55 : 0.35);
            ctx.strokeStyle = justPassed ? '#44FF88' : color;
            ctx.lineWidth   = isActive ? 3 : 1.5;
            ctx.beginPath();
            ctx.moveTo(marginLeft, y);
            ctx.lineTo(W - marginRight, y);
            ctx.stroke();
            ctx.globalAlpha = 1;

            // Note name label (e.g. "E2")
            const midi = this.targetMidis[i];
            ctx.fillStyle = isActive ? '#fff' : '#666';
            ctx.font = `${isActive ? '600 ' : ''}22px system-ui, sans-serif`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(midiToNoteName(midi), marginLeft - 12, y);
        }

        // Deviation indicator — only when a pitch is detected and we have an active string
        if (this.detectedCents !== null && currentString >= 0) {
            const y = stringY(currentString);
            const clamped = Math.max(-50, Math.min(50, this.detectedCents));
            const stringSpacing = n > 1 ? spacing : 50;
            const maxOffset = stringSpacing * 0.45;
            // Sharp = above string (negative Y), flat = below (positive Y)
            const offsetY = -(clamped / 50) * maxOffset;
            const inTune = Math.abs(this.detectedCents) <= CORRECTION_PASS_CENTS;
            const dwellMs = this.phase.tag === 'correction' ? CORRECTION_DWELL_MS : VALIDATION_DWELL_MS;
            const dwellProgress = this.dwellStart !== -Infinity
                ? Math.min(1, (timestamp - this.dwellStart) / dwellMs)
                : 0;

            ctx.strokeStyle = inTune ? '#44FF88' : '#ffffff';
            ctx.lineWidth = 4;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.moveTo(W / 2 - 60, y + offsetY);
            ctx.lineTo(W / 2 + 60, y + offsetY);
            ctx.stroke();
            ctx.globalAlpha = 1;

            // Cents readout
            ctx.fillStyle = inTune ? '#44FF88' : '#ccc';
            ctx.font = '20px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const sign = this.detectedCents > 0 ? '+' : '';
            ctx.fillText(`${sign}${Math.round(this.detectedCents)}¢`, W / 2, y + offsetY + (offsetY < 0 ? -20 : 20));

            // Dwell progress arc — fills a small circle around the bar midpoint as the
            // hold timer counts down, confirming the note is staying in tune
            if (inTune && dwellProgress > 0) {
                const cx = W / 2;
                const cy = y + offsetY;
                const r = 27;
                // Background circle
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.stroke();
                // Progress arc — clockwise from top
                ctx.strokeStyle = '#44FF88';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + dwellProgress * Math.PI * 2);
                ctx.stroke();
            }
        }

        // Phase label at top
        ctx.fillStyle = '#888';
        ctx.font = '18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        if (this.phase.tag === 'correction') {
            ctx.fillText(`String ${this.phase.stringIndex + 1} of ${n}`, W / 2, 10);
        } else if (this.phase.tag === 'validation') {
            ctx.fillText(`Checking all strings…`, W / 2, 10);
        }

        // Debug: raw detected frequency — helps diagnose detection issues; remove once stable
        if (this.lastDetectedHz !== null) {
            ctx.fillStyle = '#444';
            ctx.font = '16px system-ui, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText(`${this.lastDetectedHz.toFixed(1)} Hz`, W - marginRight, 10);
        }

        // Signal level bar — bottom of canvas; always visible so user can confirm mic is live
        const rms = this.detector?.lastRms ?? 0;
        const barMaxW = W - marginLeft - marginRight - 60;
        const barX = marginLeft;
        const barY = H - 16;
        const barH = 6;
        // Track (background)
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.roundRect(barX, barY, barMaxW, barH, 3);
        ctx.fill();
        // Fill — green when signal is strong, orange when weak
        const filled = Math.min(rms * 6, 1) * barMaxW; // scale RMS to visible range
        if (filled > 1) {
            ctx.fillStyle = rms > 0.05 ? '#44CC44' : '#CC8800';
            ctx.beginPath();
            ctx.roundRect(barX, barY, filled, barH, 3);
            ctx.fill();
        }
        // Label
        ctx.fillStyle = '#555';
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('MIC', barX + barMaxW + 10, barY + barH / 2);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private computeTargetMidis(offsets: number[]): number[] {
        const base = STANDARD_BASE_NOTES[offsets.length];
        if (!base) return offsets.map(() => 69); // fallback: A4
        return base.map((b, i) => b + (offsets[i] ?? 0));
    }
}

// ── Utility functions ─────────────────────────────────────────────────────────

function centDeviation(detectedFreq: number, targetMidi: number): number {
    const targetFreq = 440 * Math.pow(2, (targetMidi - 69) / 12);
    return 1200 * Math.log2(detectedFreq / targetFreq);
}

// Autocorrelation can lock on an octave harmonic. Check ±1200¢ and pick the
// value closest to 0 — if the detector returned an octave error, this corrects it.
function centDeviationWithOctaveCorrection(detectedFreq: number, targetMidi: number): number {
    const raw = centDeviation(detectedFreq, targetMidi);
    const below = raw - 1200;
    const above = raw + 1200;
    const candidates = [raw, below, above];
    return candidates.reduce((best, c) => Math.abs(c) < Math.abs(best) ? c : best);
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi: number): string {
    const octave = Math.floor(midi / 12) - 1;
    return NOTE_NAMES_SHARP[midi % 12] + octave;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
