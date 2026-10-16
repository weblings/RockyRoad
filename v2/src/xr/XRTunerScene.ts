import type { Entity, UIKitDocument } from "@iwsdk/core";
import { PanelDocument } from "@iwsdk/core";
import { TunerMachine, midiToNoteName, centsLabel } from "../shared/TunerMachine";
import type { PitchDetector } from "../shared/PitchDetector";
import { stringColorCss } from "../shared/StringColors";
import { loadSettings, saveSettings } from "../shared/Settings";
import type { OptionMenuLayout, WorldPointerEvent } from "./OptionDropdown";
import { OptionDropdown } from "./OptionDropdown";

// ── XRTunerScene ──────────────────────────────────────────────────────────────
// uikit panel (see ui/tuner.uikitml). Drives the shared TunerMachine from a PitchDetector each
// frame (tick) and renders needle, cents label, border wipe, checks, meter and overlays.

// Mirrors .option-item/.option-menu-inner/.option-menu in ui/tuner.uikitml.
const OPTION_MENU_LAYOUT: OptionMenuLayout = {
    itemHeight: 2.2,
    itemGap:    0.3,
    menuHeight: 8,
};

// Box 2 column slots present in the markup (7-string guitar).
const MAX_STRINGS = 7;
// How long the mic request may stay pending before the panel explains the invisible prompt.
const MIC_TIMEOUT_MS = 8000;
// Same range and step as the desktop tuner's gain slider.
const MIN_GAIN = 1;
const MAX_GAIN = 24;
const GAIN_STEP = 0.5;
const IDLE_COLOR = '#555555';
// Box 1 width in panel cm (40 minus .boxes side padding) and its corner radius as a percent
// of that. The wipe strips stop short of the corners so they stay inside the curve.
const BOX1_WIDTH = 33;
const BOX1_CORNER_PCT = (0.8 / BOX1_WIDTH) * 100;
// Same mapping as the desktop meter: full at rms 1/6, green once clearly audible.
const METER_SCALE = 6;
const METER_LIVE_RMS = 0.05;

export class XRTunerScene {
    private _doc: UIKitDocument | null = null;
    private _machine: TunerMachine | null = null;
    private _gain = 1;
    private _detector: PitchDetector | null = null;
    private _micState: 'waiting' | 'timeout' | 'ready' | 'denied' = 'waiting';
    private _active = false;
    private _showGen = 0;
    private _onDone: (complete: boolean) => void = () => {};
    private _micTimer: ReturnType<typeof setTimeout> | null = null;
    // Last values written by tick, so unchanged frames skip setProperties.
    private _lastLive = new Map<string, string>();
    private _lastStringSig = '';

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
    ): void {
        this._stopDetector();
        this._gain = loadSettings().inputGain ?? 1;
        this._machine = new TunerMachine(tuningOffsets, this._gain, g => this._detector?.setGain(g));
        this._onDone = onDone;
        this._micState = 'waiting';
        this._lastLive.clear();
        this._lastStringSig = '';
        this._active = true;
        this._startDetector(++this._showGen);

        const proceed = (doc: UIKitDocument) => {
            this._doc = doc;
            this._render(doc, onBack, onDone);
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

        this._setClick(doc, 'tn-back', onBack);
        this._setClick(doc, 'tn-done', () => onDone(m.phase.tag === 'complete'));
        this._setClick(doc, 'tn-restart', () => { m.restart(); this._lastStringSig = ''; });

        // Only Default is listed until the input list is wired to enumerateDevices.
        this._inputDropdown.setTriggerLabel(doc, 'Input: Default', 'option-label');
        this._inputDropdown.renderDynamic(
            doc, [{ label: 'Default', selected: true, onSelect: () => {} }], OPTION_MENU_LAYOUT, rerender,
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

        const result = this._detector?.detect() ?? null;
        const rms = this._detector?.lastRms ?? 0;
        m.update(timestamp, result, rms);
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

    private _startDetector(gen: number): void {
        // Quest shows the permission prompt outside the session, so a pending request looks like a hang.
        this._micTimer = setTimeout(() => {
            if (gen === this._showGen && this._micState === 'waiting') this._micState = 'timeout';
        }, MIC_TIMEOUT_MS);
        import('../shared/PitchDetector')
            .then(({ PitchDetector }) => PitchDetector.create(undefined, this._gain))
            .then(det => {
                if (gen !== this._showGen) { det.destroy(); return; }
                this._detector = det;
                this._micState = 'ready';
                this._clearMicTimer();
            })
            .catch(() => {
                if (gen !== this._showGen) return;
                this._micState = 'denied';
                this._clearMicTimer();
            });
    }

    private _clearMicTimer(): void {
        if (this._micTimer) clearTimeout(this._micTimer);
        this._micTimer = null;
    }

    private _stopDetector(): void {
        this._clearMicTimer();
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

        // White strips spread both ways from the bar along the top and bottom edges, then the
        // full white border takes over at 100%.
        const lo = Math.max(pct * (1 - p), BOX1_CORNER_PCT);
        const hi = Math.min(pct + (100 - pct) * p, 100 - BOX1_CORNER_PCT);
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

    private _updateOverlays(doc: UIKitDocument, m: TunerMachine): void {
        const done = m.phase.tag === 'complete';
        this._setLive(doc, 'tn-done-overlay', { display: done ? 'flex' : 'none' });
        this._setLive(doc, 'tn-mic-overlay', { display: !done && this._micState !== 'ready' ? 'flex' : 'none' });
        this._setLive(doc, 'tn-mic-text', {
            text: this._micState === 'denied' ? 'Mic blocked. Allow it in the browser site settings.'
                : this._micState === 'timeout' ? 'No mic prompt yet. Exit VR, tap Allow on the page, then re-enter.'
                : 'Waiting for mic access...',
        });
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
