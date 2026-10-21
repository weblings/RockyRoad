import type { Entity, UIKitDocument } from "@iwsdk/core";
import { PanelDocument } from "@iwsdk/core";
import { TunerMachine, midiToNoteName, centsLabel } from "../shared/TunerMachine";
import type { PitchDetector } from "../shared/PitchDetector";
import { shortMicLabel, isBuiltInMic } from "../shared/MicLabel";
import { stringColorCss } from "../shared/StringColors";
import { loadSettings, saveSettings } from "../shared/Settings";
import type { OptionMenuLayout, WorldPointerEvent } from "./OptionDropdown";
import { OptionDropdown } from "./OptionDropdown";
import { micPermissionState } from "./MicPermission";
import { debugLog, debugAudio, debugOn } from "../shared/DebugLog";

// ── XRTunerScene ──────────────────────────────────────────────────────────────
// uikit panel (see ui/tuner.uikitml). Drives the shared TunerMachine from a PitchDetector each
// frame (tick) and renders needle, cents label, border wipe, checks, meter and overlays.

// Mirrors .option-item/.option-menu-inner/.option-menu in ui/tuner.uikitml.
const OPTION_MENU_LAYOUT: OptionMenuLayout = {
    itemHeight: 2.2,
    itemGap:    0.3,
    menuHeight: 8,
};

// Dropdown grows to fit this many inputs before it needs scrolling. Padding/border slack is added.
const MAX_MENU_ITEMS = 6;
const MENU_SLACK = 1.0;

// Box 2 column slots present in the markup (7-string guitar).
const MAX_STRINGS = 7;
// A granted mic opens in about 75ms on Quest. Pending this long means the OS Browser toggle is off.
const MIC_TIMEOUT_MS = 500;
const PERM_RECHECK_MS = 1000;
// Mic card [title, ...up to 4 lines] per state. One short line each, no text wrapping.
const MIC_CARD_TEXT = {
    waiting: ['Waiting for mic access', 'Tap Allow if the headset asks.'],
    prompt: ['Mic permission needed', 'The prompt shows in the 2D browser.'],
    siteBlocked: ['Mic blocked for this site', 'Exit VR for the fix steps.', 'They are in the Browser app, not Settings.'],
    appBlocked: ['Mic is off for Browser', 'Exit VR, then tap Go to Settings.'],
} as const;
// Same range and step as the desktop tuner's gain slider.
const MIN_GAIN = 1;
const MAX_GAIN = 24;
const GAIN_STEP = 0.5;
// Lower than the detector default because the Quest mic is quiet. Raising gain would amplify noise too.
const XR_MIN_RMS = 0.001;
const MIN_HZ_RATIO = 0.8;
// Dismissed for the rest of the page session.
let warnDismissed = false;
const IDLE_COLOR = '#555555';
// Box 1 width in panel cm (40 minus .boxes side padding) and its corner radius as a percent
// of that. The wipe strips stop short of the corners so they stay inside the curve.
const BOX1_WIDTH = 33;
const BOX1_CORNER_PCT = (0.8 / BOX1_WIDTH) * 100;
// Same mapping as the desktop meter: full at rms 1/6, green once clearly audible.
const METER_SCALE = 6;
const METER_LIVE_RMS = 0.05;
// Dev capture: longest raw mic recording kept per tuner visit.
const DEBUG_CAPTURE_SECONDS = 90;

export class XRTunerScene {
    private _doc: UIKitDocument | null = null;
    private _machine: TunerMachine | null = null;
    private _gain = 1;
    private _detector: PitchDetector | null = null;
    private _requestPending = false;
    private _lastPermCheck = 0;
    private _onExitVR: (siteBlocked: boolean) => void = () => {};
    private _micState:'waiting' | 'prompt' | 'ready' | 'siteBlocked' | 'appBlocked' = 'waiting';
    private _active = false;
    private _showGen = 0;
    private _onDone: (complete: boolean) => void = () => {};
    // Audio inputs from enumerateDevices, filled once the mic is granted (labels are empty before).
    private _inputs: { id: string; label: string }[] = [];
    private _inputId: string | undefined;
    private _rerender: () => void = () => {};
    private _micTimer: ReturnType<typeof setTimeout> | null = null;
    // Last values written by tick, so unchanged frames skip setProperties.
    private _lastLive = new Map<string, string>();
    private _lastStringSig = '';
    private _captureCount = 0;
    private _inputsListed = false;
    private _warnShown = false;
    // Set once the user chooses an input, so auto-select never overrides them.
    private _userPicked = false;

    private _inputDropdown = new OptionDropdown({
        trigger: 'tn-input-trigger',
        triggerLabelSlot: 'tn-input-trigger-label-slot',
        chevronDown: 'tn-input-chevron-down',
        chevronUp: 'tn-input-chevron-up',
        menu: 'tn-input-menu',
        menuInner: 'tn-input-menu-inner',
    });

    show(
        panelEntity: Entity,
        tuningOffsets: number[],
        onBack: () => void,
        onDone: (complete: boolean) => void,
        onExitVR: (siteBlocked: boolean) => void = () => {},
    ): void {
        this._onExitVR = onExitVR;
        this._stopDetector();
        this._inputs = [];
        this._inputsListed = false;
        this._inputId = undefined;
        this._userPicked = false;
        this._gain = Math.min(loadSettings().inputGain ?? 1, MAX_GAIN);
        this._machine = new TunerMachine(tuningOffsets, this._gain, g => this._detector?.setGain(g));
        this._onDone = onDone;
        this._micState = 'waiting';
        this._lastLive.clear();
        this._lastStringSig = '';
        this._warnShown = false;
        this._active = true;
        this._startDetector(++this._showGen);

        const proceed = (doc: UIKitDocument) => {
            this._doc = doc;
            this._render(doc, onBack, onDone);
            // Cover the boxes right away instead of waiting for the first tick.
            this._updateOverlays(doc, this._machine!);
        };

        if (this._doc) { proceed(this._doc); return; }

        const poll = () => {
            const doc = panelEntity.getValue(PanelDocument, 'document') as UIKitDocument | null;
            if (doc) { proceed(doc); return; }
            setTimeout(poll, 100);
        };
        poll();
    }

    private _render(doc: UIKitDocument, onBack: () => void, onDone: (complete: boolean) => void): void {
        const m = this._machine;
        if (!m) return;
        const rerender = () => this._render(doc, onBack, onDone);
        this._rerender = rerender;

        this._setClick(doc, 'tn-back', onBack);
        this._setClick(doc, 'tn-done', () => onDone(m.phase.tag === 'complete'));
        this._applyWarnText(doc);
        this._setClick(doc, 'tn-warn-dismiss', () => { warnDismissed = true; });
        // On a blocked card the button just leaves VR. Allow Mic is only for the prompt state.
        this._setClick(doc, 'tn-mic-exit', () => {
            if (this._micState === 'appBlocked' || this._micState === 'siteBlocked') this._onExitVR(this._micState === 'siteBlocked');
            else this._requestMic();
        });
        this._setClick(doc, 'tn-restart', () => { m.restart(); this._lastStringSig = ''; });

        const options: { id: string | undefined; label: string }[] = [
            { id: undefined, label: 'Default' },
            ...this._inputs,
        ];
        const selected = options.find(o => o.id === this._inputId) ?? options[0];
        this._inputDropdown.setTriggerLabel(doc, `Input: ${selected.label}`, 'option-label');
        // Size the menu to its options so a few inputs never need the drag-scroll.
        const shown = Math.min(options.length, MAX_MENU_ITEMS);
        const menuHeight = shown * OPTION_MENU_LAYOUT.itemHeight + (shown - 1) * OPTION_MENU_LAYOUT.itemGap + MENU_SLACK;
        doc.getElementById('tn-input-menu')?.setProperties({ height: menuHeight });
        this._inputDropdown.renderDynamic(
            doc,
            options.map(o => ({
                label: o.label,
                selected: o === selected,
                onSelect: () => { this._userPicked = true; this._selectInput(o.id); },
            })),
            { ...OPTION_MENU_LAYOUT, menuHeight },
            rerender,
        );

        this._applyGain(doc);
        this._wireGainDrag(doc);

        this._renderStrings(doc, m);
    }

    private _renderStrings(doc: UIKitDocument, m: TunerMachine): void {
        const current = m.currentString;
        const color = current >= 0 ? stringColorCss(current) ?? '#ffffff' : IDLE_COLOR;
        doc.getElementById('tn-b1-border')?.setProperties({ borderColor: color });
        doc.getElementById('tn-b1-label')?.setProperties({
            text: current >= 0 ? midiToNoteName(m.targetMidis[current]) : '',
            color,
        });

        const n = Math.min(m.offsets.length, MAX_STRINGS);
        for (let i = 0; i < MAX_STRINGS; i++) {
            const col = doc.getElementById(`tn-col-${i}`);
            if (!col) continue;
            col.setProperties({ display: i < n ? 'flex' : 'none' });
            if (i >= n) continue;

            const state = m.checkState(i);
            // Bold/bright for the current string, dimmed for the rest.
            col.setProperties({ opacity: i === current ? 1 : 0.5 });
            const stringColor = stringColorCss(i) ?? '#ffffff';
            doc.getElementById(`tn-name-${i}`)?.setProperties({
                text: midiToNoteName(m.targetMidis[i]),
                color: stringColor,
            });
            // uikit can't tint images, so each string color has its own pre-faded PNG (tools/gen-tuner-fade.ts).
            // keepAspectRatio off so the texture doesn't resize the line once it loads.
            doc.getElementById(`tn-line-${i}`)?.setProperties({
                src: `${import.meta.env.BASE_URL}tuner-fade-${stringColor.slice(1)}.png`,
                keepAspectRatio: false,
            });
            // Pending checks stay dim, done checks are white.
            doc.getElementById(`tn-check-${i}`)?.setProperties({
                opacity: state === 'done' ? 1 : state === 'pending' ? 0.25 : 0,
            });
        }
    }

    // Releases the mic. Called when the panel is hidden.
    hide(): void {
        this._active = false;
        this._showGen++;
        this._stopDetector();
    }

    // Runs every frame while the panel is shown. timestamp is performance.now() in ms.
    tick(timestamp: number): void {
        const doc = this._doc;
        const m = this._machine;
        if (!this._active || !doc || !m) return;

        this._recheckPermission(timestamp);
        const result = this._detector?.detect() ?? null;
        const rms = this._detector?.lastRms ?? 0;
        m.update(timestamp, result, rms);
        debugLog('tuner-frames', 'f', {
            s: m.currentString, ph: m.phase.tag, rms: +rms.toFixed(5),
            hz: result ? +result.frequency.toFixed(2) : null, cl: result ? +result.clarity.toFixed(3) : null,
            c: m.displayCents === null ? null : +m.displayCents.toFixed(1),
        });
        if (m.takeCompleteHold(timestamp) && (loadSettings().tunerAutoAdvance ?? true)) {
            this._onDone(true);
            return;
        }

        const sig = `${m.phase.tag}|${m.currentString}|${m.offsets.map((_, i) => m.checkState(i) ?? '-').join()}`;
        if (sig !== this._lastStringSig) {
            this._lastStringSig = sig;
            this._renderStrings(doc, m);
        }
        this._updateNeedle(doc, m);
        this._updateMeter(doc, rms);
        this._updateOverlays(doc, m);
    }

    private _selectInput(id: string | undefined): void {
        if (id === this._inputId) return;
        this._inputId = id;
        this._stopDetector();
        this._micState = 'waiting';
        this._startDetector(++this._showGen);
        this._rerender();
    }

    private async _listInputs(gen: number): Promise<void> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            if (gen !== this._showGen) return;
            console.log('inputs:', devices.filter(d => d.kind === 'audioinput').map(d => d.label || d.deviceId.slice(0, 6)).join(' | '));
            debugLog('tuner', 'audio-devices', { devices: devices.map(d => ({ kind: d.kind, label: d.label, id: d.deviceId.slice(0, 8) })) });
            this._inputsListed = true;
            this._inputs = devices
                .filter(d => d.kind === 'audioinput' && d.deviceId !== 'default')
                .map(d => ({ id: d.deviceId, label: shortMicLabel(d.label) || d.deviceId }));
            // Prefer an external mic over the headset's gated built-in one, unless the user chose.
            const external = this._inputs.find(i => !isBuiltInMic(i.label));
            if (external && !this._userPicked && this._inputId === undefined) {
                this._selectInput(external.id);
                return;
            }
            this._rerender();
        } catch {
            // Keep Default only, and stop holding the waiting overlay for a list that won't come.
            this._inputsListed = true;
        }
    }

    private _startDetector(gen: number): void {
        // Quest shows the mic prompt outside the session, so asking in here would hang unseen.
        // A known 'prompt' state skips the request and offers Exit VR instead.
        void micPermissionState().then(state => {
            if (gen !== this._showGen) return;
            if (state === 'prompt') { this._micState = 'prompt'; return; }
            this._openMic(gen);
        });
    }

    // Ask from the button's own gesture so the Quest prompt may show without leaving VR.
    // The user can change the site permission outside VR while this card is up, so follow it.
    private _recheckPermission(now: number): void {
        if (this._micState !== 'siteBlocked' && this._micState !== 'prompt') return;
        if (now - this._lastPermCheck < PERM_RECHECK_MS) return;
        this._lastPermCheck = now;
        const gen = this._showGen;
        void micPermissionState().then(state => {
            if (gen !== this._showGen) return;
            if (state === 'granted' && (this._micState === 'siteBlocked' || this._micState === 'prompt')) {
                this._micState = 'waiting';
                this._startDetector(++this._showGen);
            } else if (state === 'prompt' && this._micState === 'siteBlocked') {
                this._micState = 'prompt';
            } else if (state === 'denied' && this._micState === 'prompt') {
                this._micState = 'siteBlocked';
            }
        });
    }

    private _requestMic(): void {
        debugLog('tuner', 'mic-request-click', {});
        if (this._requestPending) return;
        this._requestPending = true;
        // With the OS Browser mic off, getUserMedia never settles. A hang with the site granted reads as an OS block.
        const t0 = performance.now();
        const hang = setTimeout(async () => {
            const state = await micPermissionState();
            debugLog('tuner', 'mic-request-hung', { state });
            // A pending prompt is the user still answering, not a block.
            if (state === 'granted') this._micState = 'appBlocked';
            else if (state === 'denied') this._micState = 'siteBlocked';
        }, MIC_TIMEOUT_MS);
        navigator.mediaDevices.getUserMedia({ audio: true })
            .finally(() => { clearTimeout(hang); this._requestPending = false; })
            .then(stream => {
                stream.getTracks().forEach(t => t.stop());
                debugLog('tuner', 'mic-request-granted', { ms: Math.round(performance.now() - t0) });
                this._micState = 'waiting';
                this._startDetector(++this._showGen);
            })
            .catch(async (e: unknown) => {
                const state = await micPermissionState();
                debugLog('tuner', 'mic-request-failed', { name: (e as { name?: string })?.name, message: (e as { message?: string })?.message, state });
                this._micState = state === 'denied' ? 'siteBlocked' : state === 'prompt' ? 'prompt' : 'appBlocked';
            });
    }

    private _openMic(gen: number): void {
        // Fallback when the permission state can't be read and the request stays pending.
        const t0 = performance.now();
        this._micTimer = setTimeout(async () => {
            if (gen !== this._showGen || this._micState !== 'waiting') return;
            // Site already allowed yet still pending means the OS Browser toggle is off.
            const state = await micPermissionState();
            debugLog('tuner', 'mic-open-hung', { state });
            if (gen !== this._showGen || this._micState !== 'waiting') return;
            this._micState = state === 'granted' ? 'appBlocked' : 'prompt';
        }, MIC_TIMEOUT_MS);
        import('../shared/PitchDetector')
            .then(({ PitchDetector }) => PitchDetector.create(this._inputId, this._gain, XR_MIN_RMS, this._minHz()))
            .then(det => {
                if (gen !== this._showGen) { det.destroy(); return; }
                this._detector = det;
                this._micState = 'ready';
                if (debugOn('tuner')) {
                    debugLog('tuner', 'tuner-mic-ready', { ms: Math.round(performance.now() - t0), label: this._inputs.find(i => i.id === this._inputId)?.label ?? 'Default', n: this._captureCount, rate: det.sampleRate, gain: this._gain, minRms: XR_MIN_RMS, settings: det.trackSettings });
                    det.startCapture(DEBUG_CAPTURE_SECONDS);
                }
                this._clearMicTimer();
                if (this._inputs.length === 0) void this._listInputs(gen);
            })
            .catch(async (e: unknown) => {
                if (gen !== this._showGen) return;
                this._clearMicTimer();
                // A stored site denial reads 'denied'. Anything else points at the OS-level Browser toggle.
                const state = await micPermissionState();
                debugLog('tuner', 'mic-open-failed', { name: (e as { name?: string })?.name, message: (e as { message?: string })?.message, state });
                if (gen !== this._showGen) return;
                this._micState = state === 'denied' ? 'siteBlocked' : 'appBlocked';
            });
    }

    // Sends the dev recording (if any) to the PC before the detector is released.
    private _uploadCapture(): void {
        const det = this._detector;
        const pcm = det?.stopCapture();
        if (det && pcm && pcm.length > 0) debugAudio('tuner', `tuner${this._captureCount++}`, pcm, det.sampleRate);
    }

    // Lowest pitch worth hearing: a bit under the lowest target, so a flat string is still found
    // but room rumble is not.
    private _minHz(): number {
        const lowest = Math.min(...(this._machine?.targetMidis ?? [40]));
        return 440 * Math.pow(2, (lowest - 69) / 12) * MIN_HZ_RATIO;
    }

    private _clearMicTimer(): void {
        if (this._micTimer) clearTimeout(this._micTimer);
        this._micTimer = null;
    }

    private _stopDetector(): void {
        this._clearMicTimer();
        this._uploadCapture();
        this._detector?.destroy();
        this._detector = null;
    }

    // Writes properties only when they changed since the last frame.
    private _setLive(doc: UIKitDocument, id: string, props: Record<string, unknown>): void {
        const key = JSON.stringify(props);
        if (this._lastLive.get(id) === key) return;
        this._lastLive.set(id, key);
        doc.getElementById(id)?.setProperties(props);
    }

    private _updateNeedle(doc: UIKitDocument, m: TunerMachine): void {
        const show = m.showNeedle;
        const pct = show ? Math.round((Math.max(-50, Math.min(50, m.displayCents!)) + 50) * 10) / 10 : 50;
        const p = show ? Math.round(m.dwellProgress * 50) / 50 : 0;

        this._setLive(doc, 'tn-bar', { display: show ? 'flex' : 'none', positionLeft: `${pct}%` });
        this._setLive(doc, 'tn-cents', {
            display: show ? 'flex' : 'none',
            positionLeft: `${pct}%`,
            transformTranslateX: `-${pct}%`,
            ...(show ? { text: centsLabel(m.displayCents!) } : {}),
        });

        // White strips spread both ways from the bar's center target along the top and bottom
        // edges, then the full white border takes over at 100%.
        const lo = Math.max(50 * (1 - p), BOX1_CORNER_PCT);
        const hi = Math.min(50 + 50 * p, 100 - BOX1_CORNER_PCT);
        const strip = {
            display: p > 0 && p < 1 ? 'flex' : 'none',
            positionLeft: `${lo}%`,
            width: `${Math.max(0, hi - lo)}%`,
        };
        this._setLive(doc, 'tn-strip-top', strip);
        this._setLive(doc, 'tn-strip-bottom', strip);
        this._setLive(doc, 'tn-lock', { display: p >= 1 ? 'flex' : 'none' });
    }

    private _updateMeter(doc: UIKitDocument, rms: number): void {
        const pct = Math.round(Math.min(rms * METER_SCALE, 1) * 50) * 2;
        this._setLive(doc, 'tn-meter-fill', {
            height: `${pct}%`,
            backgroundColor: rms > METER_LIVE_RMS ? '#44cc44' : '#cc8800',
        });
    }

    // The Settings path is verified on Quest only, so other headsets get the general wording.
    private _applyWarnText(doc: UIKitDocument): void {
        const quest = /OculusBrowser|Quest/i.test(navigator.userAgent);
        doc.getElementById('tn-warn-quest')?.setProperties({ display: quest ? 'flex' : 'none' });
        doc.getElementById('tn-warn-l1b')?.setProperties({ display: quest ? 'none' : 'flex' });
        if (quest) return;
        doc.getElementById('tn-warn-title')?.setProperties({ text: 'Headset mics often miss guitar' });
        doc.getElementById('tn-warn-l1')?.setProperties({ text: 'If a USB or wireless mic works with your' });
    }

    // True once the input list is known and holds nothing but the headset's built-in routes.
    private _weakMic(): boolean {
        if (warnDismissed || this._micState !== 'ready' || !this._inputsListed) return false;
        return this._inputs.length > 0 && this._inputs.every(i => isBuiltInMic(i.label));
    }

    private _updateOverlays(doc: UIKitDocument, m: TunerMachine): void {
        const done = m.phase.tag === 'complete';
        // Held until the input list is known so the boxes never flash before the warning or an auto-select restart.
        const waiting = !done && (this._micState !== 'ready' || !this._inputsListed);
        const warn = !done && !waiting && this._weakMic();
        if (warn !== this._warnShown) {
            this._warnShown = warn;
            debugLog('tuner', 'weak-mic-warning', { shown: warn });
        }
        this._setLive(doc, 'tn-warn-overlay', { display: warn ? 'flex' : 'none' });
        this._setLive(doc, 'tn-done-overlay', { display: done ? 'flex' : 'none' });
        this._setLive(doc, 'tn-mic-overlay', { display: waiting ? 'flex' : 'none' });
        // Hidden under an overlay so their images can't z-fight through it.
        this._setLive(doc, 'tn-box1', { display: done || waiting || warn ? 'none' : 'flex' });
        this._setLive(doc, 'tn-box2', { display: done || waiting || warn ? 'none' : 'flex' });
        // No card text while the answer is still unknown, so the wrong message never flashes.
        this._setLive(doc, 'tn-mic-card', { display: this._micState === 'waiting' || this._micState === 'ready' ? 'none' : 'flex' });
        const [title, ...lines] = MIC_CARD_TEXT[this._micState === 'ready' ? 'waiting' : this._micState];
        this._setLive(doc, 'tn-mic-title', { text: title });
        for (let i = 0; i < 4; i++) {
            const line = lines[i];
            this._setLive(doc, `tn-mic-l${i + 1}`, line ? { text: line, display: 'flex' } : { display: 'none' });
        }
        const blocked = this._micState === 'appBlocked' || this._micState === 'siteBlocked';
        this._setLive(doc, 'tn-mic-exit', { display: this._micState === 'prompt' || blocked ? 'flex' : 'none' });
        this._setLive(doc, 'tn-mic-exit-label', { text: 'Exit VR' });
    }

    private _applyGain(doc: UIKitDocument): void {
        const pct = ((this._gain - MIN_GAIN) / (MAX_GAIN - MIN_GAIN)) * 100;
        doc.getElementById('tn-gain-fill')?.setProperties({ width: `${pct}%` });
        doc.getElementById('tn-gain-thumb')?.setProperties({ positionLeft: `${pct}%` });
        doc.getElementById('tn-gain-val')?.setProperties({ text: `${this._gain}x` });
    }

    // Tap or drag anywhere on the slider. worldToLocal on the stable slider element, per the
    // pointer-drag lesson, with capture so the drag survives leaving the thin track.
    private _wireGainDrag(doc: UIKitDocument): void {
        const slider = doc.getElementById('tn-gain-slider');
        if (!slider) return;
        let dragging = false;

        const setFromPointer = (e: WorldPointerEvent): void => {
            if (!e.point) return;
            const f = Math.max(0, Math.min(slider.worldToLocal(e.point.clone()).x + 0.5, 1));
            const gain = Math.round((MIN_GAIN + f * (MAX_GAIN - MIN_GAIN)) / GAIN_STEP) * GAIN_STEP;
            if (gain === this._gain) return;
            this._gain = gain;
            this._machine?.setInputGain(gain);
            this._detector?.setGain(gain);
            this._applyGain(doc);
        };

        slider.setProperties({
            onPointerDown: (e: WorldPointerEvent) => {
                dragging = true;
                e.currentTarget?.setPointerCapture?.(e.pointerId);
                setFromPointer(e);
            },
            onPointerMove: (e: WorldPointerEvent) => { if (dragging) setFromPointer(e); },
            onPointerUp: (e: WorldPointerEvent) => {
                if (!dragging) return;
                dragging = false;
                e.currentTarget?.releasePointerCapture?.(e.pointerId);
                const s = loadSettings();
                s.inputGain = this._gain;
                saveSettings(s);
            },
        });
    }

    private _setClick(doc: UIKitDocument, id: string, onClick: () => void): void {
        doc.getElementById(id)?.setProperties({ onClick });
    }
}
