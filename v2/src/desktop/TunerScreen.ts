import * as THREE from "three";
import type { App, IScreen } from "./App";
import type { SongIndexEntry, SongIndexPart } from "../shared/SongIndex";
import type { ISongSource } from "../shared/SongSource";
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
// Time constant for easing the needle toward the detected pitch; higher is calmer but laggier.
const NEEDLE_SMOOTHING_MS = 160;
// Readings in the median filter that rejects single-frame spikes before easing.
const NEEDLE_MEDIAN_WINDOW = 7;
// Minimum pitch-detector clarity (0 to 1) for a reading to move the needle.
const NEEDLE_MIN_CLARITY = 0.8;
// Matches the mic meter's 8px thickness and full rounding.
const STRING_THICKNESS = 8;
// Needle's resting length, and the width of the left column holding the per-string checks.
const NEEDLE_LENGTH = 120;
const CHECK_COL = 24;
// How far the needle can swing toward the next string, as a fraction of the string gap.
const NEEDLE_REACH = 0.45;
// Thinner than the strings so the needle stays distinct when it overlaps one.
const NEEDLE_THICKNESS = 4;
// Width of the white outline that fills around the active string while the note is held.
const LOCK_BORDER = 2;
const STRING_COLORS = ['#FF4444', '#FFA500', '#FFFF00', '#00CC00', '#4488FF', '#FF88FF'];

// Tolerance thresholds (cents)
const CORRECTION_PASS_CENTS = 10;
const VALIDATION_PASS_CENTS = 15;

// How long the string must stay in tune before advancing (ms)
const CORRECTION_DWELL_MS = 475;
const VALIDATION_DWELL_MS = 235;

// How long the ✓ stays before auto-advancing (ms)
const COMPLETE_HOLD_MS = 1000;

// ── TunerScreen ───────────────────────────────────────────────────────────────

export class TunerScreen implements IScreen {
    private app: App;
    private texture: THREE.Texture;
    private source: ISongSource;
    private entry: SongIndexEntry;
    private part: SongIndexPart;
    private context: TunerContext;
    private selectedDifficulty: number | null;
    private pausedAt: number;   // only relevant for mid-song

    private offsets: number[];
    private targetMidis: number[];

    private phase: TunerPhase = { tag: 'correction', stringIndex: 0 };
    private detectedCents: number | null = null;
    // Eased copy of detectedCents for drawing only; the state machine keeps using the raw value.
    private displayCents: number | null = null;
    private detectedClarity = 0;
    private lastDrawTs = 0;
    private centsHistory: number[] = [];
    private historyString = -1;
    // Which side of the string the needle was on when the hold began: -1 above, +1 below.
    private lockSide: -1 | 1 = -1;
    private completeTimestamp = 0;


    private container: HTMLElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx2d: CanvasRenderingContext2D | null = null;
    private meterFill: HTMLElement | null = null;
    private dpr = 1;
    private rafId = 0;

    private detector: PitchDetector | null = null;
    private invertStrings = false;
    private inputGain = 1;

    private dwellStart = -Infinity;

    private validationStringEnteredAt = -Infinity;

    private signalPresentNoDetectStart = -Infinity;
    private autoBoostActive = false;

    constructor(
        app: App,
        texture: THREE.Texture,
        source: ISongSource,
        entry: SongIndexEntry,
        part: SongIndexPart,
        context: TunerContext,
        selectedDifficulty: number | null = null,
        pausedAt = 0,
    ) {
        this.app = app;
        this.texture = texture;
        this.source = source;
        this.entry = entry;
        this.part = part;
        this.context = context;
        this.selectedDifficulty = selectedDifficulty;
        this.pausedAt = pausedAt;

        this.offsets = part.tuningOffsets ?? [];
        this.targetMidis = this.computeTargetMidis(this.offsets);
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
                                <div class="tuner-meter"><div class="tuner-meter-fill" id="tuner-meter-fill"></div></div>
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
        this.meterFill = container.querySelector<HTMLElement>('#tuner-meter-fill');
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

        const gainSlider = container.querySelector<HTMLInputElement>('#tuner-gain');
        const paintGainFill = () => {
            if (!gainSlider) return;
            const min = Number(gainSlider.min), max = Number(gainSlider.max);
            gainSlider.style.setProperty('--slider-percent', `${((Number(gainSlider.value) - min) / (max - min)) * 100}%`);
        };
        paintGainFill();
        gainSlider?.addEventListener('input', e => {
            paintGainFill();
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
        this.meterFill = null;
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
                inputs.map(d => `<option value="${esc(d.deviceId)}">${esc(shortMicLabel(d.label) || d.deviceId)}</option>`).join('');
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
                const cents = centDeviationWithOctaveCorrection(result.frequency, this.targetMidis[currentString]);
                this.detectedCents = cents;
                this.detectedClarity = result.clarity;
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
                        this.app, this.texture, this.source, this.entry, this.part,
                        this.selectedDifficulty, det,
                    ));
                });
                break;
            }
            case 'mid-song':
                this.app.resumeWithCountdown(this.pausedAt);
                break;
            case 'menu':
                import('./SongLibraryScreen').then(({ SongLibraryScreen }) => {
                    this.app.navigate(new SongLibraryScreen(this.app, this.texture));
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

        // One outer padding on every side. Top/bottom margins leave room for the needle to swing
        // past the outermost strings (NEEDLE_REACH of a string gap), solved because the gap itself
        // depends on the margin: m = PAD + needle/2 + REACH * (H - 2m) / (n - 1).
        const PAD          = 24;
        const marginV      = n > 1
            ? (PAD + NEEDLE_THICKNESS / 2 + NEEDLE_REACH * H / (n - 1)) / (1 + 2 * NEEDLE_REACH / (n - 1))
            : H / 2;
        const marginTop    = marginV;
        const marginBottom = marginV;
        const marginLeft   = PAD + CHECK_COL + 44;
        const marginRight  = PAD;
        const stringAreaH  = H - marginTop - marginBottom;
        const spacing      = n > 1 ? stringAreaH / (n - 1) : 0;

        const stringY = (i: number) => this.invertStrings
            ? marginTop + i * spacing
            : marginTop + (n - 1 - i) * spacing;

        const currentString = this.phase.tag === 'correction' ? this.phase.stringIndex
                            : this.phase.tag === 'validation'  ? this.phase.stringIndex
                            : -1;
        const isValidation = this.phase.tag === 'validation';

        const dt = timestamp - this.lastDrawTs;
        this.lastDrawTs = timestamp;
        if (this.detectedCents === null || currentString !== this.historyString) this.centsHistory = [];
        this.historyString = currentString;
        if (this.detectedCents === null) {
            this.displayCents = null;
        } else {
            // Low-clarity readings (harmonics, octave slips) are skipped for display only, so the
            // needle holds its last spot instead of leaping.
            if (this.detectedClarity >= NEEDLE_MIN_CLARITY) {
                this.centsHistory.push(this.detectedCents);
                if (this.centsHistory.length > NEEDLE_MEDIAN_WINDOW) this.centsHistory.shift();
            }
            if (this.centsHistory.length > 0) {
                const target = [...this.centsHistory].sort((a, b) => a - b)[this.centsHistory.length >> 1];
                this.displayCents = this.displayCents === null || this.centsHistory.length === 1
                    ? target
                    : this.displayCents + (target - this.displayCents) * (1 - Math.exp(-dt / NEEDLE_SMOOTHING_MS));
            }
        }

        const stringLen = W - marginRight - marginLeft;
        const needleCx = marginLeft + stringLen / 2;
        const showNeedle = this.detectedCents !== null && this.displayCents !== null && currentString >= 0;
        let needleY = 0;
        let dwellProgress = 0;
        if (showNeedle) {
            const clamped = Math.max(-50, Math.min(50, this.displayCents!));
            const stringSpacing = n > 1 ? spacing : 50;
            needleY = stringY(currentString) - (clamped / 50) * stringSpacing * NEEDLE_REACH;
            const dwellMs = this.phase.tag === 'correction' ? CORRECTION_DWELL_MS : VALIDATION_DWELL_MS;
            dwellProgress = this.dwellStart !== -Infinity
                ? Math.min(1, (timestamp - this.dwellStart) / dwellMs)
                : 0;

            if (dwellProgress === 0) {
                this.lockSide = needleY <= stringY(currentString) ? -1 : 1;
                // Drawn before the strings so it slips behind the active one when they line up.
                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 0.9;
                ctx.beginPath();
                ctx.roundRect(needleCx - NEEDLE_LENGTH / 2, needleY - NEEDLE_THICKNESS / 2, NEEDLE_LENGTH, NEEDLE_THICKNESS, NEEDLE_THICKNESS / 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        }

        for (let i = 0; i < n; i++) {
            const y = stringY(i);
            const isActive = i === currentString;
            const color = STRING_COLORS[i] ?? '#ffffff';

            ctx.globalAlpha = isActive ? 1.0 : (isValidation ? 0.55 : 0.35);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(marginLeft, y - STRING_THICKNESS / 2, stringLen, STRING_THICKNESS, STRING_THICKNESS / 2);
            ctx.fill();
            ctx.globalAlpha = 1;

            // White outline wraps the string starting from the side the needle was on.
            if (isActive && showNeedle && dwellProgress > 0) {
                strokeLockBorder(ctx, marginLeft, y, stringLen, this.lockSide, dwellProgress);
            }

            const midi = this.targetMidis[i];
            ctx.fillStyle = isActive ? '#fff' : '#8b8b8b';
            ctx.font = `${isActive ? '600 ' : ''}16px 'Inter', system-ui, sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(midiToNoteName(midi), PAD + CHECK_COL, y);

            // Correction pass: tuned strings get a bright check. Validation pass: every string
            // starts with a dim check from correction and brightens as it is re-verified.
            const checkState = this.phase.tag === 'complete' ? 'done'
                : this.phase.tag === 'validation' ? (this.phase.results[i] ? 'done' : 'pending')
                : (i < this.phase.stringIndex ? 'done' : null);
            if (checkState) drawCheck(ctx, PAD + 6, y, checkState === 'done' ? '#ffffff' : '#515151');
        }

        if (showNeedle) {
            ctx.globalAlpha = 1 - dwellProgress;
            ctx.fillStyle = '#c8c8c8';
            ctx.font = "14px 'Inter', system-ui, sans-serif";
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const shown = Math.round(this.displayCents!);
            // Past ±99 the exact number adds nothing (needle is pinned), so say which way to go.
            const label = Math.abs(shown) > 99 ? (shown > 0 ? 'Sharp' : 'Flat') : (shown > 0 ? `+${shown}` : `${shown}`);
            ctx.fillText(label, needleCx + NEEDLE_LENGTH / 2 + 12, needleY);
            ctx.globalAlpha = 1;
        }

        if (this.meterFill) {
            const rms = this.detector?.lastRms ?? 0;
            this.meterFill.style.height = `${Math.min(rms * 6, 1) * 100}%`;
            this.meterFill.style.background = rms > 0.05 ? '#44CC44' : '#CC8800';
        }
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

// Outlines the string's rounded rect: the near edge (top for side -1, bottom for side 1) sweeps out
// from its midpoint while the caps and far edge fade in together.
function strokeLockBorder(
    ctx: CanvasRenderingContext2D, x: number, y: number, len: number, side: -1 | 1, progress: number,
): void {
    const b = LOCK_BORDER;
    const x0 = x - b / 2, w = len + b, h = STRING_THICKNESS + b, r = h / 2;
    const cx = x0 + w / 2;
    const near = y + side * r, far = y - side * r;
    const edge = (w - 2 * r) / 2;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = b;
    ctx.lineCap = 'butt';
    // Near edge sweeps out from its midpoint, the direction the note needs to travel from.
    ctx.setLineDash([progress * edge, edge * 4]);
    for (const dir of [1, -1]) {
        ctx.save();
        ctx.translate(cx, 0);
        ctx.scale(dir, 1);
        ctx.translate(-cx, 0);
        ctx.beginPath();
        ctx.moveTo(cx, near);
        ctx.lineTo(x0 + w - r, near);
        ctx.stroke();
        ctx.restore();
    }
    // Caps and far edge fade in together, so that side fills at once instead of closing in.
    ctx.setLineDash([]);
    ctx.globalAlpha = progress;
    ctx.beginPath();
    ctx.moveTo(x0 + w - r, near);
    ctx.arc(x0 + w - r, y, r, side * Math.PI / 2, -side * Math.PI / 2, side > 0);
    ctx.lineTo(x0 + r, far);
    ctx.arc(x0 + r, y, r, -side * Math.PI / 2, side * Math.PI / 2, side > 0);
    ctx.stroke();
    ctx.restore();
}

function drawCheck(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx - 1.5, cy + 4);
    ctx.lineTo(cx + 5, cy - 4);
    ctx.stroke();
}

// Drops Chrome's trailing hardware id, e.g. "Mic (046d:0825)" -> "Mic", so collapsed names stay short.
function shortMicLabel(label: string): string {
    return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
