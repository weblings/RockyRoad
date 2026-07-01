import * as THREE from "three";
import type { App, IScreen } from "./App";
import type { ISongLibrary, SongIndexEntry, SongIndexPart } from "../shared/SongIndex";
import { STANDARD_BASE_NOTES } from "../shared/SongIndex";
import { loadSettings, saveSettings } from "../shared/Settings";
import type { PitchDetector } from "../shared/PitchDetector";

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

    private offsets: number[];
    private targetMidis: number[];

    private phase: TunerPhase = { tag: 'correction', stringIndex: 0 };
    private detectedCents: number | null = null;
    private completeTimestamp = 0;

    private stringPassTime: number[] = [];

    private container: HTMLElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx2d: CanvasRenderingContext2D | null = null;
    private dpr = 1;
    private rafId = 0;

    private detector: PitchDetector | null = null;
    private invertStrings = false;
    private inputGain = 1;

    private dwellStart = -Infinity;
    private lastDetectedHz: number | null = null;

    private validationStringEnteredAt = -Infinity;

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

        container.innerHTML = `
            <div class="tuner-screen">
                <div class="tuner-body">
                    <div class="tuner-main">

                        <div class="tuner-controls-row">
                            <label class="tuner-ctrl-inline">
                                <span class="tuner-ctrl-label-inline">Input</span>
                                <select class="tuner-select" id="tuner-input-select">
                                    <option value="">Default mic</option>
                                </select>
                            </label>
                            <div class="tuner-ctrl-divider"></div>
                            <label class="tuner-ctrl-inline">
                                <span class="tuner-ctrl-label-inline">Gain</span>
                                <input type="range" class="tuner-gain-slider" id="tuner-gain"
                                    min="1" max="24" step="0.5" value="${this.inputGain}" />
                                <span id="tuner-gain-val">${this.inputGain}×</span>
                            </label>
                            <div class="tuner-ctrl-divider"></div>
                            <button class="tuner-btn" id="tuner-restart">Restart</button>
                            <button class="tuner-btn tuner-btn-exit" id="tuner-back">Done</button>
                        </div>

                        <div class="tuner-canvas-wrap">
                            <canvas id="tuner-canvas" width="960" height="540"></canvas>
                            <div class="tuner-complete-overlay hidden" id="tuner-complete">
                                <div class="tuner-check">✓</div>
                                <div class="tuner-in-tune">In tune!</div>
                                ${!autoAdvance ? `<button class="tuner-exit-btn" id="tuner-exit-complete">Done</button>` : ''}
                            </div>
                            <div class="tuner-mic-wait hidden" id="tuner-mic-wait">Waiting for mic access…</div>
                        </div>

                    </div>
                </div>
            </div>`;

        this.canvas = container.querySelector<HTMLCanvasElement>('#tuner-canvas')!;
        this.ctx2d  = this.canvas.getContext('2d')!;

        this.dpr = window.devicePixelRatio || 1;
        const cssW = this.canvas.width;
        const cssH = this.canvas.height;
        this.canvas.style.width  = `${cssW}px`;
        this.canvas.style.height = `${cssH}px`;
        this.canvas.width  = Math.round(cssW * this.dpr);
        this.canvas.height = Math.round(cssH * this.dpr);
        this.ctx2d.scale(this.dpr, this.dpr);

        container.querySelector('#tuner-restart')?.addEventListener('click', () => this.restart());
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

        this.rafId = requestAnimationFrame(t => this.tick(t));
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

    private async startDetector(container: HTMLElement, gain: number): Promise<void> {
        const micWait = container.querySelector<HTMLElement>('#tuner-mic-wait');
        if (micWait) micWait.classList.remove('hidden');
        try {
            const { PitchDetector } = await import('../shared/PitchDetector');
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
            const { PitchDetector } = await import('../shared/PitchDetector');
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

    private tick(timestamp: number): void {
        if (!this.canvas || !this.ctx2d) return;

        const result = this.detector?.detect() ?? null;
        const n = this.offsets.length;

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

        if (this.phase.tag === 'complete' && this.completeTimestamp > 0) {
            const settings = loadSettings();
            const autoAdvance = settings.tunerAutoAdvance ?? true;
            if (autoAdvance && timestamp - this.completeTimestamp >= COMPLETE_HOLD_MS) {
                this.completeTimestamp = 0;
                this.exit();
            }
        }
    }

    private static readonly VALIDATION_TIMEOUT_MS = 5000;

    private advanceStateMachine(cents: number, timestamp: number): void {
        const n = this.offsets.length;

        if (this.phase.tag === 'correction') {
            if (Math.abs(cents) <= CORRECTION_PASS_CENTS) {
                if (this.dwellStart === -Infinity) this.dwellStart = timestamp;

                if (timestamp - this.dwellStart >= CORRECTION_DWELL_MS) {
                    this.dwellStart = -Infinity;
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

    private exit(): void {
        if (this.phase.tag === 'complete') {
            this.app.lastTuningKey = JSON.stringify(this.offsets);
        }
        cancelAnimationFrame(this.rafId);

        switch (this.context) {
            case 'song-flow': {
                const det = this.detector;
                this.detector = null;
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
                import('./SongLibraryScreen').then(({ SongLibraryScreen }) => {
                    this.app.navigate(new SongLibraryScreen(this.app, this.texture, this.library));
                });
                break;
        }
    }

    private drawCanvas(timestamp: number): void {
        const canvas = this.canvas!;
        const ctx = this.ctx2d!;
        const n = this.offsets.length;
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

        const stringY = (i: number) => this.invertStrings
            ? marginTop + i * spacing
            : marginTop + (n - 1 - i) * spacing;

        const currentString = this.phase.tag === 'correction' ? this.phase.stringIndex
                            : this.phase.tag === 'validation'  ? this.phase.stringIndex
                            : -1;
        const isValidation = this.phase.tag === 'validation';

        for (let i = 0; i < n; i++) {
            const y = stringY(i);
            const isActive = i === currentString;
            const color = STRING_COLORS[i] ?? '#ffffff';

            const timeSincePass = timestamp - this.stringPassTime[i];
            const justPassed = timeSincePass < 350;

            ctx.globalAlpha = isActive ? 1.0 : (isValidation ? 0.55 : 0.35);
            ctx.strokeStyle = justPassed ? '#44FF88' : color;
            ctx.lineWidth   = isActive ? 3 : 1.5;
            ctx.beginPath();
            ctx.moveTo(marginLeft, y);
            ctx.lineTo(W - marginRight, y);
            ctx.stroke();
            ctx.globalAlpha = 1;

            const midi = this.targetMidis[i];
            ctx.fillStyle = isActive ? '#fff' : '#666';
            ctx.font = `${isActive ? '600 ' : ''}22px system-ui, sans-serif`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(midiToNoteName(midi), marginLeft - 12, y);
        }

        if (this.detectedCents !== null && currentString >= 0) {
            const y = stringY(currentString);
            const clamped = Math.max(-50, Math.min(50, this.detectedCents));
            const stringSpacing = n > 1 ? spacing : 50;
            const maxOffset = stringSpacing * 0.45;
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

            ctx.fillStyle = inTune ? '#44FF88' : '#ccc';
            ctx.font = '20px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const sign = this.detectedCents > 0 ? '+' : '';
            ctx.fillText(`${sign}${Math.round(this.detectedCents)}¢`, W / 2, y + offsetY + (offsetY < 0 ? -20 : 20));

            if (inTune && dwellProgress > 0) {
                const cx = W / 2;
                const cy = y + offsetY;
                const r = 27;
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.stroke();
                ctx.strokeStyle = '#44FF88';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + dwellProgress * Math.PI * 2);
                ctx.stroke();
            }
        }

        ctx.fillStyle = '#888';
        ctx.font = '18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        if (this.phase.tag === 'correction') {
            ctx.fillText(`String ${this.phase.stringIndex + 1} of ${n}`, W / 2, 10);
        } else if (this.phase.tag === 'validation') {
            ctx.fillText(`Checking all strings…`, W / 2, 10);
        }

        if (this.lastDetectedHz !== null) {
            ctx.fillStyle = '#444';
            ctx.font = '16px system-ui, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText(`${this.lastDetectedHz.toFixed(1)} Hz`, W - marginRight, 10);
        }

        const rms = this.detector?.lastRms ?? 0;
        const barMaxW = W - marginLeft - marginRight - 60;
        const barX = marginLeft;
        const barY = H - 16;
        const barH = 6;
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.roundRect(barX, barY, barMaxW, barH, 3);
        ctx.fill();
        const filled = Math.min(rms * 6, 1) * barMaxW;
        if (filled > 1) {
            ctx.fillStyle = rms > 0.05 ? '#44CC44' : '#CC8800';
            ctx.beginPath();
            ctx.roundRect(barX, barY, filled, barH, 3);
            ctx.fill();
        }
        ctx.fillStyle = '#555';
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('MIC', barX + barMaxW + 10, barY + barH / 2);
    }

    private computeTargetMidis(offsets: number[]): number[] {
        const base = STANDARD_BASE_NOTES[offsets.length];
        if (!base) return offsets.map(() => 69);
        return base.map((b, i) => b + (offsets[i] ?? 0));
    }
}

// ── Utility functions ─────────────────────────────────────────────────────────

function centDeviation(detectedFreq: number, targetMidi: number): number {
    const targetFreq = 440 * Math.pow(2, (targetMidi - 69) / 12);
    return 1200 * Math.log2(detectedFreq / targetFreq);
}

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
