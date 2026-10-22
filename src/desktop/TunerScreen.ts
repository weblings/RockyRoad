import * as THREE from "three";
import type { App, IScreen } from "./App";
import type { SongIndexEntry, SongIndexPart } from "../shared/SongIndex";
import type { ISongSource } from "../shared/SongSource";
import { TunerMachine, midiToNoteName, centsLabel } from "../shared/TunerMachine";
import { loadSettings, saveSettings } from "../shared/Settings";
import { stringColorCss } from "../shared/StringColors";
import { shortMicLabel } from "../shared/MicLabel";
import type { PitchDetector } from "../shared/PitchDetector";

const BACK_SVG = `<svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.0908 14.3334C12.972 14.3334 12.9125 14.1898 12.9965 14.1058L17.7021 9.40022C17.9625 9.13987 17.9625 8.71776 17.7021 8.45741L16.2879 7.04319C16.0275 6.78284 15.6054 6.78284 15.3451 7.04319L6.8598 15.5285C6.59945 15.7888 6.59945 16.2109 6.8598 16.4713L8.27401 17.8855L8.27536 17.8868L15.3453 24.9568C15.6057 25.2172 16.0278 25.2172 16.2881 24.9568L17.7024 23.5426C17.9627 23.2822 17.9627 22.8601 17.7024 22.5998L12.9969 17.8944C12.9129 17.8104 12.9724 17.6668 13.0912 17.6668L26 17.6668C26.3682 17.6668 26.6667 17.3683 26.6667 17.0001V15.0001C26.6667 14.6319 26.3682 14.3334 26 14.3334L13.0908 14.3334Z" fill="currentColor"/></svg>`;

const REPLAY_SVG = `<svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M15.6038 12.2147C16.0439 12.5399 16.6667 12.2257 16.6667 11.6786V10.1789C16.6667 10.1001 16.7351 10.0384 16.8134 10.0479C20.1116 10.4494 22.6667 13.2593 22.6667 16.6659C22.6667 20.3481 19.6817 23.3332 15.9995 23.3332C12.542 23.3332 9.69927 20.7014 9.36509 17.332C9.32875 16.9655 9.03371 16.6662 8.66548 16.6662L6.66655 16.6666C6.29841 16.6666 5.99769 16.966 6.02187 17.3334C6.36494 22.5454 10.7012 26.6667 16 26.6667C21.5228 26.6667 26 22.1895 26 16.6667C26 11.4103 21.9444 7.10112 16.7916 6.69757C16.7216 6.69209 16.6667 6.63396 16.6667 6.56372V4.98824C16.6667 4.44106 16.0439 4.12689 15.6038 4.45206L11.0765 7.79738C10.7159 8.06387 10.7159 8.60326 11.0766 8.86973L15.6038 12.2147Z" fill="currentColor"/></svg>`;
const PLAY_SVG = `<svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.6667 6.6548C10.6667 6.10764 11.2894 5.79346 11.7295 6.11862L24.377 15.4634C24.7377 15.7298 24.7377 16.2692 24.3771 16.5357L11.7295 25.8813C11.2895 26.2065 10.6667 25.8923 10.6667 25.3451L10.6667 6.6548Z" fill="currentColor"/></svg>`;
const CHECK_PATH = "M24.9266 7.57992C25.015 7.60672 25.0886 7.64746 25.2462 7.80506L26.956 9.51488C27.1136 9.67248 27.1543 9.74604 27.1811 9.83447C27.2079 9.9229 27.2079 10.0133 27.1811 10.1018C27.1543 10.1902 27.1136 10.2638 26.956 10.4214L13.1822 24.1951C13.0246 24.3527 12.951 24.3935 12.8626 24.4203C12.797 24.4402 12.7304 24.4453 12.6642 24.4357L12.7319 24.4203C12.6435 24.4471 12.553 24.4471 12.4646 24.4203C12.3762 24.3935 12.3026 24.3527 12.145 24.1951L5.04407 17.0942C4.88647 16.9366 4.84573 16.863 4.81893 16.7746C4.79213 16.6862 4.79213 16.5957 4.81893 16.5073C4.84573 16.4189 4.88647 16.3453 5.04407 16.1877L6.7539 14.4779C6.9115 14.3203 6.98506 14.2796 7.07349 14.2528C7.16191 14.226 7.25235 14.226 7.34078 14.2528C7.42921 14.2796 7.50277 14.3203 7.66037 14.4779L12.6628 19.4808L24.3397 7.80506C24.4973 7.64746 24.5709 7.60672 24.6593 7.57992C24.7477 7.55311 24.8382 7.55311 24.9266 7.57992Z";
const CHECK_SVG = `<svg class="tuner-check" viewBox="0 0 32 32" aria-hidden="true"><path d="${CHECK_PATH}" /></svg>`;
const CHECK_2D = new Path2D(CHECK_PATH);

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

// Layout breakpoints on the tuner body's inner size. Large switches immediately when the 960x540
// canvas stops fitting. Narrow starts when Box 1's track would drop under ~160px.
const LARGE_MIN_W = 960;
const LARGE_MIN_H = 760;
const MEDIUM_MIN_W = 560;
type TunerLayout = 'large' | 'medium' | 'narrow';

// ── TunerScreen ───────────────────────────────────────────────────────────────

export class TunerScreen implements IScreen {
    private app: App;
    private texture: THREE.Texture;
    private source: ISongSource;
    private entry: SongIndexEntry;
    private part: SongIndexPart;
    private selectedDifficulty: number | null;

    private machine: TunerMachine;

    private container: HTMLElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx2d: CanvasRenderingContext2D | null = null;
    private meterFill: HTMLElement | null = null;
    private dpr = 1;
    private rafId = 0;
    private layout: TunerLayout = 'large';
    private layoutObserver: ResizeObserver | null = null;
    private boxEls: {
        box1: HTMLElement; wipe: HTMLElement; label: HTMLElement; bar: HTMLElement; cents: HTMLElement;
        cols: HTMLElement[];
    } | null = null;

    private detector: PitchDetector | null = null;
    private invertStrings = false;
    private inputGain = 1;

    constructor(
        app: App,
        texture: THREE.Texture,
        source: ISongSource,
        entry: SongIndexEntry,
        part: SongIndexPart,
        selectedDifficulty: number | null = null,
    ) {
        this.app = app;
        this.texture = texture;
        this.source = source;
        this.entry = entry;
        this.part = part;
        this.selectedDifficulty = selectedDifficulty;

        this.machine = new TunerMachine(
            part.tuningOffsets ?? [], loadSettings().inputGain ?? 1, g => this.detector?.setGain(g),
        );
    }

    async mount(container: HTMLElement): Promise<void> {
        this.container = container;
        const settings = loadSettings();
        const autoAdvance = settings.tunerAutoAdvance ?? true;
        this.invertStrings = settings.invertStrings;
        this.inputGain = settings.inputGain ?? 1;
        this.machine.setInputGain(this.inputGain);

        container.innerHTML = `
            <div class="tuner-screen">
                <div class="tuner-nav-bar">
                    <button class="btn btn-dark" id="tuner-nav-back" type="button">
                        ${BACK_SVG}
                        <span>Back</span>
                    </button>
                </div>
                <div class="tuner-body">
                    <div class="tuner-main" data-layout="large">

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
                            ${this.boxesHtml()}
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
                                <span>Retune</span>
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
        this.bindBoxes(container);

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
            this.machine.setInputGain(val);
            const label = container.querySelector('#tuner-gain-val');
            if (label) label.textContent = `${val}×`;
            this.detector?.setGain(val);
            const s = loadSettings();
            s.inputGain = val;
            saveSettings(s);
        });

        const body = container.querySelector<HTMLElement>('.tuner-body')!;
        this.layoutObserver = new ResizeObserver(() => this.applyLayout(body));
        this.layoutObserver.observe(body);
        this.applyLayout(body);

        this.rafId = requestAnimationFrame(t => this.tick(t));
        this.startDetector(container, this.inputGain);
    }

    unmount(): void {
        cancelAnimationFrame(this.rafId);
        this.layoutObserver?.disconnect();
        this.layoutObserver = null;
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
        this.machine.update(timestamp, result, this.detector?.lastRms ?? 0);
        if (this.machine.phase.tag === 'complete') {
            this.container?.querySelector('#tuner-complete')?.classList.remove('hidden');
        }

        if (this.layout === 'large') this.drawCanvas(); else this.updateBoxes();
        this.rafId = requestAnimationFrame(t => this.tick(t));

        const autoAdvance = loadSettings().tunerAutoAdvance ?? true;
        if (autoAdvance && this.machine.takeCompleteHold(timestamp)) this.exit();
    }

    private restart(): void {
        this.machine.restart();
        this.container?.querySelector('#tuner-complete')?.classList.add('hidden');
    }

    // Leaves without marking the tuning done, returning to the pre-scene screen.
    private back(): void {
        cancelAnimationFrame(this.rafId);
        import('./PreSceneScreen').then(({ PreSceneScreen }) => {
            this.app.navigate(new PreSceneScreen(this.app, this.texture, this.source, this.entry));
        });
    }

    private exit(): void {
        if (this.machine.phase.tag === 'complete') {
            this.app.lastTuningKey = JSON.stringify(this.machine.offsets);
        }
        cancelAnimationFrame(this.rafId);

        const det = this.detector;
        this.detector = null;
        import('./ActiveSceneScreen').then(({ ActiveSceneScreen }) => {
            this.app.navigate(new ActiveSceneScreen(
                this.app, this.texture, this.source, this.entry, this.part,
                this.selectedDifficulty, det,
            ));
        });
    }

    private drawCanvas(): void {
        const canvas = this.canvas!;
        const ctx = this.ctx2d!;
        const m = this.machine;
        const n = m.offsets.length;
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

        const currentString = m.currentString;
        const isValidation = m.phase.tag === 'validation';

        const dwellProgress = m.dwellProgress;

        const stringLen = W - marginRight - marginLeft;
        // Needle sits in the gutter past the strings' right ends, so its label never overlaps one.
        const needleX = marginLeft + stringLen + 12;
        const showNeedle = m.showNeedle;
        let needleY = 0;
        if (showNeedle) {
            const clamped = Math.max(-50, Math.min(50, m.displayCents!));
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

            const midi = m.targetMidis[i];
            ctx.fillStyle = isActive ? '#fff' : '#8b8b8b';
            ctx.font = `${isActive ? '600 ' : ''}16px 'Inter', system-ui, sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(midiToNoteName(midi), PAD + CHECK_COL, y);

            // Correction pass: tuned strings get a bright check. Validation pass: every string
            // starts with a dim check from correction and brightens as it is re-verified.
            const checkState = m.checkState(i);
            if (checkState) drawCheck(ctx, PAD + 6, y, checkState === 'done' ? '#ffffff' : '#515151');
        }

        if (showNeedle) {
            ctx.fillStyle = '#c8c8c8';
            ctx.font = "14px 'Inter', system-ui, sans-serif";
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(centsLabel(m.displayCents!), needleX + NEEDLE_LENGTH + 8, needleY);
        }

        if (this.meterFill) {
            const rms = this.detector?.lastRms ?? 0;
            this.meterFill.style.height = `${Math.min(rms * 6, 1) * 100}%`;
            this.meterFill.style.background = rms > 0.05 ? '#44CC44' : '#CC8800';
        }
    }

    private boxesHtml(): string {
        const n = this.machine.offsets.length;
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
                            <span class="tuner-box2-name">${midiToNoteName(this.machine.targetMidis[i])}</span>
                            <div class="tuner-box2-line"></div>
                        </div>`).join('')}
                </div>
            </div>`;
    }

    private bindBoxes(container: HTMLElement): void {
        this.boxEls = {
            box1: container.querySelector('#tuner-box1')!,
            wipe: container.querySelector('#tuner-box1-wipe')!,
            label: container.querySelector('#tuner-box1-label')!,
            bar: container.querySelector('#tuner-box1-bar')!,
            cents: container.querySelector('#tuner-box1-cents')!,
            cols: [...container.querySelectorAll<HTMLElement>('.tuner-box2-col')],
        };
    }

    // Picks Large, Medium or Narrow from the body's inner size and tags .tuner-main for the CSS.
    private applyLayout(body: HTMLElement): void {
        const w = body.clientWidth - 32, h = body.clientHeight - 32;
        const next: TunerLayout = w >= LARGE_MIN_W && h >= LARGE_MIN_H ? 'large'
            : w >= MEDIUM_MIN_W ? 'medium' : 'narrow';
        if (next === this.layout) return;
        this.layout = next;
        body.querySelector('.tuner-main')?.setAttribute('data-layout', next);
    }

    // Drives the DOM boxes from the same display state and phase as the canvas.
    private updateBoxes(): void {
        const els = this.boxEls;
        if (!els) return;
        const m = this.machine;
        const current = m.currentString;
        const color = current >= 0 ? stringColorCss(current) ?? '#fff' : '#555';
        els.box1.style.setProperty('--string-color', color);
        els.label.textContent = current >= 0 ? midiToNoteName(m.targetMidis[current]) : '';

        const showNeedle = m.showNeedle;
        els.bar.classList.toggle('hidden', !showNeedle);
        els.cents.classList.toggle('hidden', !showNeedle);
        if (showNeedle) {
            const pct = (Math.max(-50, Math.min(50, m.displayCents!)) + 50);
            els.bar.style.left = `${pct}%`;
            els.cents.style.left = `${pct}%`;
            els.cents.style.transform = `translateX(-${pct}%)`;
            els.cents.textContent = centsLabel(m.displayCents!);
            // Wipe spreads both ways from the bar's x and closes on the sides at full progress.
            const p = m.dwellProgress;
            const left = pct * (1 - p), right = 100 - (pct + (100 - pct) * p);
            els.wipe.style.clipPath = p > 0 ? `inset(0 ${right}% 0 ${left}%)` : 'inset(0 100% 0 100%)';
        } else {
            els.wipe.style.clipPath = 'inset(0 100% 0 100%)';
        }

        for (const col of els.cols) {
            const i = Number(col.dataset.string);
            const checkState = m.checkState(i);
            col.classList.toggle('current', i === current);
            col.dataset.check = checkState ?? '';
        }

        if (this.meterFill) {
            const rms = this.detector?.lastRms ?? 0;
            this.meterFill.style.height = `${Math.min(rms * 6, 1) * 100}%`;
            this.meterFill.style.background = rms > 0.05 ? '#44CC44' : '#CC8800';
        }
    }

}

// ── Utility functions ─────────────────────────────────────────────────────────


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

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
