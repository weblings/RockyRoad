import * as THREE from "three";
import type { App, IScreen } from "./App";
import type { SongIndexEntry, SongIndexPart } from "../shared/SongIndex";
import type { ISongSource } from "../shared/SongSource";
import { STANDARD_BASE_NOTES } from "../shared/SongIndex";
import { loadSettings, saveSettings } from "../shared/Settings";
import { stringColorCss } from "../shared/StringColors";
import type { PitchDetector } from "../shared/PitchDetector";

const BACK_SVG = `<svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.0908 14.3334C12.972 14.3334 12.9125 14.1898 12.9965 14.1058L17.7021 9.40022C17.9625 9.13987 17.9625 8.71776 17.7021 8.45741L16.2879 7.04319C16.0275 6.78284 15.6054 6.78284 15.3451 7.04319L6.8598 15.5285C6.59945 15.7888 6.59945 16.2109 6.8598 16.4713L8.27401 17.8855L8.27536 17.8868L15.3453 24.9568C15.6057 25.2172 16.0278 25.2172 16.2881 24.9568L17.7024 23.5426C17.9627 23.2822 17.9627 22.8601 17.7024 22.5998L12.9969 17.8944C12.9129 17.8104 12.9724 17.6668 13.0912 17.6668L26 17.6668C26.3682 17.6668 26.6667 17.3683 26.6667 17.0001V15.0001C26.6667 14.6319 26.3682 14.3334 26 14.3334L13.0908 14.3334Z" fill="currentColor"/></svg>`;
const SETTINGS_SVG = `<svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.3321 4C12.598 4 11.9728 4.50932 11.8154 5.22745L11.4396 6.96752C10.8867 7.19965 10.3672 7.49361 9.88904 7.84127L8.19799 7.29239C7.50395 7.06339 6.74634 7.35056 6.37926 7.98082L4.71259 10.8636C4.34551 11.4939 4.48613 12.2948 5.04981 12.7627L6.42361 13.9071C6.38394 14.2002 6.36329 14.4981 6.36329 14.8C6.36329 15.1019 6.38394 15.3998 6.42361 15.6929L5.04981 16.8373C4.48613 17.3052 4.34551 18.1061 4.71259 18.7364L6.37926 21.6192C6.74634 22.2494 7.50395 22.5366 8.19799 22.3076L9.88904 21.7587C10.3672 22.1064 10.8867 22.4003 11.4396 22.6325L11.8154 24.3725C11.9728 25.0907 12.598 25.6 13.3321 25.6H16.6654C17.3994 25.6 18.0247 25.0907 18.182 24.3725L18.5579 22.6325C19.1107 22.4003 19.6303 22.1064 20.1084 21.7587L21.7995 22.3076C22.4935 22.5366 23.2511 22.2494 23.6182 21.6192L25.2849 18.7364C25.6519 18.1061 25.5113 17.3052 24.9476 16.8373L23.5738 15.6929C23.6135 15.3998 23.6342 15.1019 23.6342 14.8C23.6342 14.4981 23.6135 14.2002 23.5738 13.9071L24.9476 12.7627C25.5113 12.2948 25.6519 11.4939 25.2849 10.8636L23.6182 7.98082C23.2511 7.35056 22.4935 7.06339 21.7995 7.29239L20.1084 7.84127C19.6303 7.49361 19.1107 7.19965 18.5579 6.96752L18.182 5.22745C18.0247 4.50932 17.3994 4 16.6654 4H13.3321ZM14.9987 18.4C16.9869 18.4 18.5987 16.7882 18.5987 14.8C18.5987 12.8118 16.9869 11.2 14.9987 11.2C13.0105 11.2 11.3987 12.8118 11.3987 14.8C11.3987 16.7882 13.0105 18.4 14.9987 18.4Z" fill="currentColor"/></svg>`;

const REPLAY_SVG = `<svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M15.6038 12.2147C16.0439 12.5399 16.6667 12.2257 16.6667 11.6786V10.1789C16.6667 10.1001 16.7351 10.0384 16.8134 10.0479C20.1116 10.4494 22.6667 13.2593 22.6667 16.6659C22.6667 20.3481 19.6817 23.3332 15.9995 23.3332C12.542 23.3332 9.69927 20.7014 9.36509 17.332C9.32875 16.9655 9.03371 16.6662 8.66548 16.6662L6.66655 16.6666C6.29841 16.6666 5.99769 16.966 6.02187 17.3334C6.36494 22.5454 10.7012 26.6667 16 26.6667C21.5228 26.6667 26 22.1895 26 16.6667C26 11.4103 21.9444 7.10112 16.7916 6.69757C16.7216 6.69209 16.6667 6.63396 16.6667 6.56372V4.98824C16.6667 4.44106 16.0439 4.12689 15.6038 4.45206L11.0765 7.79738C10.7159 8.06387 10.7159 8.60326 11.0766 8.86973L15.6038 12.2147Z" fill="currentColor"/></svg>`;
const PLAY_SVG = `<svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.6667 6.6548C10.6667 6.10764 11.2894 5.79346 11.7295 6.11862L24.377 15.4634C24.7377 15.7298 24.7377 16.2692 24.3771 16.5357L11.7295 25.8813C11.2895 26.2065 10.6667 25.8923 10.6667 25.3451L10.6667 6.6548Z" fill="currentColor"/></svg>`;
const CHECK_PATH = "M24.9266 7.57992C25.015 7.60672 25.0886 7.64746 25.2462 7.80506L26.956 9.51488C27.1136 9.67248 27.1543 9.74604 27.1811 9.83447C27.2079 9.9229 27.2079 10.0133 27.1811 10.1018C27.1543 10.1902 27.1136 10.2638 26.956 10.4214L13.1822 24.1951C13.0246 24.3527 12.951 24.3935 12.8626 24.4203C12.797 24.4402 12.7304 24.4453 12.6642 24.4357L12.7319 24.4203C12.6435 24.4471 12.553 24.4471 12.4646 24.4203C12.3762 24.3935 12.3026 24.3527 12.145 24.1951L5.04407 17.0942C4.88647 16.9366 4.84573 16.863 4.81893 16.7746C4.79213 16.6862 4.79213 16.5957 4.81893 16.5073C4.84573 16.4189 4.88647 16.3453 5.04407 16.1877L6.7539 14.4779C6.9115 14.3203 6.98506 14.2796 7.07349 14.2528C7.16191 14.226 7.25235 14.226 7.34078 14.2528C7.42921 14.2796 7.50277 14.3203 7.66037 14.4779L12.6628 19.4808L24.3397 7.80506C24.4973 7.64746 24.5709 7.60672 24.6593 7.57992C24.7477 7.55311 24.8382 7.55311 24.9266 7.57992Z";
const CHECK_SVG = `<svg class="tuner-check" viewBox="0 0 32 32" aria-hidden="true"><path d="${CHECK_PATH}" /></svg>`;
const CHECK_2D = new Path2D(CHECK_PATH);

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
// Needle's length, the right-hand gutter (gap + needle + gap + label) it lives in, and the width of the
// left column holding the per-string checks.
const NEEDLE_LENGTH = 24;
const NEEDLE_GUTTER = 70;
const CHECK_COL = 24;
// How far the needle can swing toward the next string, as a fraction of the string gap.
const NEEDLE_REACH = 0.45;
// Thinner than the strings so the needle stays distinct when it overlaps one.
const NEEDLE_THICKNESS = 4;
// Width of the white outline that fills around the active string while the note is held.
const LOCK_BORDER = 2;

// Dev toggle for the DOM box layout: add ?tunerBoxes to the URL. Canvas stays the default.
const USE_BOXES = new URLSearchParams(location.search).has('tunerBoxes');

// Tolerance thresholds (cents)
const CORRECTION_PASS_CENTS = 10;
const VALIDATION_PASS_CENTS = 15;

// How long the string must stay in tune before advancing (ms)
const CORRECTION_DWELL_MS = 475;
const VALIDATION_DWELL_MS = 235;

// How long a reading may stay out of tolerance (or missing) before the hold resets (ms)
const DWELL_GRACE_MS = 150;

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
    // Hold progress 0..1, nonzero only while the needle is shown. Shared by canvas and DOM renderers.
    private dwellProgress = 0;
    private lastDrawTs = 0;
    private centsHistory: number[] = [];
    private historyString = -1;
    private completeTimestamp = 0;


    private container: HTMLElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx2d: CanvasRenderingContext2D | null = null;
    private meterFill: HTMLElement | null = null;
    private dpr = 1;
    private rafId = 0;
    private boxEls: {
        box1: HTMLElement; wipe: HTMLElement; label: HTMLElement; bar: HTMLElement; cents: HTMLElement;
        cols: HTMLElement[];
    } | null = null;

    private detector: PitchDetector | null = null;
    private invertStrings = false;
    private inputGain = 1;

    private dwellStart = -Infinity;
    private dwellMissSince = -Infinity;

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
                <div class="tuner-nav-bar">
                    <button class="btn btn-dark" id="tuner-nav-back" type="button">
                        ${BACK_SVG}
                        <span>Back</span>
                    </button>
                    <button class="btn btn-dark" id="tuner-settings" type="button">
                        ${SETTINGS_SVG}
                        <span>Settings</span>
                    </button>
                </div>
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
                            <label class="tuner-ctrl-inline">
                                <span class="tuner-ctrl-label-inline">Gain</span>
                                <input type="range" class="tuner-gain-slider" id="tuner-gain"
                                    min="1" max="24" step="0.5" value="${this.inputGain}" />
                                <span id="tuner-gain-val">${this.inputGain}×</span>
                            </label>
                        </div>

                        <div class="tuner-canvas-wrap">
                            <canvas id="tuner-canvas" width="960" height="540"></canvas>
                            ${USE_BOXES ? this.boxesHtml() : ''}
                            <div class="tuner-complete-overlay hidden" id="tuner-complete">
                                ${CHECK_SVG}
                                <div class="tuner-in-tune">In tune!</div>
                                ${!autoAdvance ? `<button class="btn btn-light btn-lg tuner-exit-btn" id="tuner-exit-complete">${PLAY_SVG}<span>Play</span></button>` : ''}
                            </div>
                            <div class="tuner-mic-wait hidden" id="tuner-mic-wait">Waiting for mic access…</div>
                        </div>

                        <div class="tuner-actions-row">
                            <button class="btn btn-dark btn-lg tuner-action-btn" id="tuner-restart">
                                ${REPLAY_SVG}
                                <span>Restart</span>
                            </button>
                            <button class="btn btn-light btn-lg tuner-action-btn" id="tuner-back">
                                ${PLAY_SVG}
                                <span>Play</span>
                            </button>
                        </div>

                    </div>
                </div>
            </div>`;

        this.canvas = container.querySelector<HTMLCanvasElement>('#tuner-canvas')!;
        this.meterFill = container.querySelector<HTMLElement>('#tuner-meter-fill');
        this.ctx2d  = this.canvas.getContext('2d')!;
        if (USE_BOXES) this.bindBoxes(container);

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
        container.querySelector('#tuner-nav-back')!.addEventListener('click', () => this.back());
        container.querySelector('#tuner-settings')!.addEventListener('click', () => this.app.openSettings());

        // Lets the shared Settings panel show the string options and update the needle live.
        this.app.activeInstrumentType = this.part.type;
        this.app.onSettingsChange = s => { this.invertStrings = s.invertStrings; };
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
        this.app.activeInstrumentType = null;
        this.app.onSettingsChange = null;
        this.detector?.destroy();
        this.detector = null;
        if (this.container) this.container.innerHTML = '';
        this.container = null;
        this.canvas = null;
        this.meterFill = null;
        this.boxEls = null;
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
                this.breakDwell(timestamp);
            }
        }

        this.updateDisplayState(timestamp);
        if (USE_BOXES) this.updateBoxes(); else this.drawCanvas();
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

    // Resets the hold only after readings stay bad past the grace period, so single-frame jitter
    // doesn't snap the lock outline back to empty.
    private breakDwell(timestamp: number): void {
        if (this.dwellStart === -Infinity) return;
        if (this.dwellMissSince === -Infinity) this.dwellMissSince = timestamp;
        if (timestamp - this.dwellMissSince >= DWELL_GRACE_MS) {
            this.dwellStart = -Infinity;
            this.dwellMissSince = -Infinity;
        }
    }

    private advanceStateMachine(cents: number, timestamp: number): void {
        const n = this.offsets.length;

        if (this.phase.tag === 'correction') {
            if (Math.abs(cents) <= CORRECTION_PASS_CENTS) {
                this.dwellMissSince = -Infinity;
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
                this.breakDwell(timestamp);
            }
        } else if (this.phase.tag === 'validation') {
            if (Math.abs(cents) <= VALIDATION_PASS_CENTS) {
                this.dwellMissSince = -Infinity;
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
                this.breakDwell(timestamp);
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
        this.dwellMissSince = -Infinity;
        this.validationStringEnteredAt = -Infinity;
        this.signalPresentNoDetectStart = -Infinity;
        this.autoBoostActive = false;
        this.detector?.setGain(this.inputGain);
        this.container?.querySelector('#tuner-complete')?.classList.add('hidden');
        this.completeTimestamp = 0;
    }

    // Leaves without marking the tuning done, returning to the screen that opened the tuner.
    private back(): void {
        cancelAnimationFrame(this.rafId);
        switch (this.context) {
            case 'song-flow':
                import('./PreSceneScreen').then(({ PreSceneScreen }) => {
                    this.app.navigate(new PreSceneScreen(this.app, this.texture, this.source, this.entry));
                });
                break;
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

    // Updates the eased needle value and hold progress that every renderer reads.
    private updateDisplayState(timestamp: number): void {
        const currentString = this.phase.tag === 'complete' ? -1 : this.phase.stringIndex;

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

        const showNeedle = this.detectedCents !== null && this.displayCents !== null && currentString >= 0;
        const dwellMs = this.phase.tag === 'correction' ? CORRECTION_DWELL_MS : VALIDATION_DWELL_MS;
        this.dwellProgress = showNeedle && this.dwellStart !== -Infinity
            ? Math.min(1, (timestamp - this.dwellStart) / dwellMs)
            : 0;
    }

    private drawCanvas(): void {
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
        const marginRight  = PAD + NEEDLE_GUTTER;
        const stringAreaH  = H - marginTop - marginBottom;
        const spacing      = n > 1 ? stringAreaH / (n - 1) : 0;

        const stringY = (i: number) => this.invertStrings
            ? marginTop + i * spacing
            : marginTop + (n - 1 - i) * spacing;

        const currentString = this.phase.tag === 'correction' ? this.phase.stringIndex
                            : this.phase.tag === 'validation'  ? this.phase.stringIndex
                            : -1;
        const isValidation = this.phase.tag === 'validation';

        const dwellProgress = this.dwellProgress;

        const stringLen = W - marginRight - marginLeft;
        // Needle sits in the gutter past the strings' right ends, so its label never overlaps one.
        const needleX = marginLeft + stringLen + 12;
        const showNeedle = this.detectedCents !== null && this.displayCents !== null && currentString >= 0;
        let needleY = 0;
        if (showNeedle) {
            const clamped = Math.max(-50, Math.min(50, this.displayCents!));
            const stringSpacing = n > 1 ? spacing : 50;
            const offsetY = -(clamped / 50) * stringSpacing * NEEDLE_REACH;
            needleY = stringY(currentString) + offsetY;

            // During the hold the needle settles onto the string's height and thickens to match it.
            needleY = stringY(currentString) + offsetY * (1 - dwellProgress);
            const needleThick = NEEDLE_THICKNESS + dwellProgress * (STRING_THICKNESS - NEEDLE_THICKNESS);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(needleX, needleY - needleThick / 2, NEEDLE_LENGTH, needleThick, needleThick / 2);
            ctx.fill();
        }

        for (let i = 0; i < n; i++) {
            const y = stringY(i);
            const isActive = i === currentString;
            const color = stringColorCss(i) ?? '#ffffff';

            ctx.globalAlpha = isActive ? 1.0 : (isValidation ? 0.55 : 0.35);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(marginLeft, y - STRING_THICKNESS / 2, stringLen, STRING_THICKNESS, STRING_THICKNESS / 2);
            ctx.fill();
            ctx.globalAlpha = 1;

            // White outline wipes in from the needle's end of the string.
            if (isActive && showNeedle && dwellProgress > 0) {
                strokeLockBorder(ctx, marginLeft, y, stringLen, dwellProgress);
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
            ctx.fillStyle = '#c8c8c8';
            ctx.font = "14px 'Inter', system-ui, sans-serif";
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const shown = Math.round(this.displayCents!);
            // Past ±99 the exact number adds nothing (needle is pinned), so say which way to go.
            const label = Math.abs(shown) > 99 ? (shown > 0 ? 'Sharp' : 'Flat') : (shown > 0 ? `+${shown}` : `${shown}`);
            ctx.fillText(label, needleX + NEEDLE_LENGTH + 8, needleY);
        }

        if (this.meterFill) {
            const rms = this.detector?.lastRms ?? 0;
            this.meterFill.style.height = `${Math.min(rms * 6, 1) * 100}%`;
            this.meterFill.style.background = rms > 0.05 ? '#44CC44' : '#CC8800';
        }
    }

    private boxesHtml(): string {
        const n = this.offsets.length;
        const cols = Array.from({ length: n }, (_, i) => i);
        return `
            <div class="tuner-boxes">
                <div class="tuner-box tuner-box1" id="tuner-box1">
                    <div class="tuner-box1-border"></div>
                    <div class="tuner-box1-wipe" id="tuner-box1-wipe"></div>
                    <div class="tuner-box1-label" id="tuner-box1-label"></div>
                    <div class="tuner-box1-lane">
                        <div class="tuner-box1-track"><div class="tuner-box1-tick"></div></div>
                        <div class="tuner-box1-bar hidden" id="tuner-box1-bar"></div>
                        <div class="tuner-box1-cents hidden" id="tuner-box1-cents"></div>
                    </div>
                </div>
                <div class="tuner-box tuner-box2" id="tuner-box2">
                    ${cols.map(i => `
                        <div class="tuner-box2-col" data-string="${i}" style="color:${stringColorCss(i) ?? '#fff'}">
                            ${CHECK_SVG}
                            <span class="tuner-box2-name">${midiToNoteName(this.targetMidis[i])}</span>
                            <div class="tuner-box2-line"></div>
                        </div>`).join('')}
                </div>
            </div>`;
    }

    private bindBoxes(container: HTMLElement): void {
        container.querySelector('#tuner-canvas')?.classList.add('hidden');
        this.boxEls = {
            box1: container.querySelector('#tuner-box1')!,
            wipe: container.querySelector('#tuner-box1-wipe')!,
            label: container.querySelector('#tuner-box1-label')!,
            bar: container.querySelector('#tuner-box1-bar')!,
            cents: container.querySelector('#tuner-box1-cents')!,
            cols: [...container.querySelectorAll<HTMLElement>('.tuner-box2-col')],
        };
    }

    // Drives the DOM boxes from the same display state and phase as the canvas.
    private updateBoxes(): void {
        const els = this.boxEls;
        if (!els) return;
        const current = this.phase.tag === 'complete' ? -1 : this.phase.stringIndex;
        const color = current >= 0 ? stringColorCss(current) ?? '#fff' : '#555';
        els.box1.style.setProperty('--string-color', color);
        els.label.textContent = current >= 0 ? midiToNoteName(this.targetMidis[current]) : '';

        const showNeedle = this.detectedCents !== null && this.displayCents !== null && current >= 0;
        els.bar.classList.toggle('hidden', !showNeedle);
        els.cents.classList.toggle('hidden', !showNeedle);
        if (showNeedle) {
            const pct = (Math.max(-50, Math.min(50, this.displayCents!)) + 50);
            els.bar.style.left = `${pct}%`;
            els.cents.style.left = `${pct}%`;
            els.cents.style.transform = `translateX(-${pct}%)`;
            const shown = Math.round(this.displayCents!);
            els.cents.textContent = Math.abs(shown) > 99 ? (shown > 0 ? 'Sharp' : 'Flat') : (shown > 0 ? `+${shown}` : `${shown}`);
            // Wipe spreads both ways from the bar's x and closes on the sides at full progress.
            const p = this.dwellProgress;
            const left = pct * (1 - p), right = 100 - (pct + (100 - pct) * p);
            els.wipe.style.clipPath = p > 0 ? `inset(0 ${right}% 0 ${left}%)` : 'inset(0 100% 0 100%)';
        } else {
            els.wipe.style.clipPath = 'inset(0 100% 0 100%)';
        }

        for (const col of els.cols) {
            const i = Number(col.dataset.string);
            const checkState = this.phase.tag === 'complete' ? 'done'
                : this.phase.tag === 'validation' ? (this.phase.results[i] ? 'done' : 'pending')
                : (i < this.phase.stringIndex ? 'done' : null);
            col.classList.toggle('current', i === current);
            col.dataset.check = checkState ?? '';
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

// Outlines the string's rounded rect, revealed by a wipe from the right end (beside the needle) leftward.
function strokeLockBorder(
    ctx: CanvasRenderingContext2D, x: number, y: number, len: number, progress: number,
): void {
    const b = LOCK_BORDER;
    const x0 = x - b / 2, w = len + b, h = STRING_THICKNESS + b;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 + w * (1 - progress), y - h, w * progress, h * 2);
    ctx.clip();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = b;
    ctx.beginPath();
    ctx.roundRect(x0, y - h / 2, w, h, h / 2);
    ctx.stroke();
    ctx.restore();
}

function drawCheck(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
    ctx.save();
    // Half-size icon, nudged up 1px because the check's visual mass sits below its box center.
    ctx.translate(cx - 8, cy - 9);
    ctx.scale(0.5, 0.5);
    ctx.fillStyle = color;
    ctx.fill(CHECK_2D);
    ctx.restore();
}

// Drops Chrome's trailing hardware id, e.g. "Mic (046d:0825)" -> "Mic", so collapsed names stay short.
function shortMicLabel(label: string): string {
    return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
