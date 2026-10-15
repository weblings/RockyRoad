import type { Entity, UIKitDocument } from "@iwsdk/core";
import { PanelDocument } from "@iwsdk/core";
import { TunerMachine, midiToNoteName } from "../shared/TunerMachine";
import { stringColorCss } from "../shared/StringColors";
import { loadSettings, saveSettings } from "../shared/Settings";
import type { OptionMenuLayout, WorldPointerEvent } from "./OptionDropdown";
import { OptionDropdown } from "./OptionDropdown";

// ── XRTunerScene ──────────────────────────────────────────────────────────────
// uikit panel (see ui/tuner.uikitml). Renders the shared TunerMachine's state statically:
// no mic, detector or needle yet.

// Mirrors .option-item/.option-menu-inner/.option-menu in ui/tuner.uikitml.
const OPTION_MENU_LAYOUT: OptionMenuLayout = {
    itemHeight: 2.2,
    itemGap:    0.3,
    menuHeight: 8,
};

// Box 2 column slots present in the markup (7-string guitar).
const MAX_STRINGS = 7;
// Same range and step as the desktop tuner's gain slider.
const MIN_GAIN = 1;
const MAX_GAIN = 24;
const GAIN_STEP = 0.5;
const IDLE_COLOR = '#555555';

export class XRTunerScene {
    private _doc: UIKitDocument | null = null;
    private _machine: TunerMachine | null = null;
    private _gain = 1;

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
        onDone: () => void,
    ): void {
        this._gain = loadSettings().inputGain ?? 1;
        this._machine = new TunerMachine(tuningOffsets, this._gain, () => {});

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

    private _render(doc: UIKitDocument, onBack: () => void, onDone: () => void): void {
        const m = this._machine;
        if (!m) return;
        const rerender = () => this._render(doc, onBack, onDone);

        this._setClick(doc, 'tn-back', onBack);
        this._setClick(doc, 'tn-done', onDone);
        this._setClick(doc, 'tn-restart', () => { m.restart(); rerender(); });

        // Only Default is listed until the input list is wired to enumerateDevices.
        this._inputDropdown.setTriggerLabel(doc, 'Input: Default', 'option-label');
        this._inputDropdown.renderDynamic(
            doc, [{ label: 'Default', selected: true, onSelect: () => {} }], OPTION_MENU_LAYOUT, rerender,
        );

        this._applyGain(doc);
        this._wireGainDrag(doc);

        const current = m.currentString;
        const color = current >= 0 ? stringColorCss(current) ?? '#ffffff' : IDLE_COLOR;
        doc.getElementById('tn-box1')?.setProperties({ borderColor: color });
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
            doc.getElementById(`tn-line-${i}`)?.setProperties({ backgroundColor: stringColor });
            // Pending checks stay dim, done checks are white.
            doc.getElementById(`tn-check-${i}`)?.setProperties({
                opacity: state === 'done' ? 1 : state === 'pending' ? 0.25 : 0,
            });
        }
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
