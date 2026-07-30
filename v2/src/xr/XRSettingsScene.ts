import type { Entity, UIKitDocument } from "@iwsdk/core";
import { PanelDocument } from "@iwsdk/core";
import { loadSettings, saveSettings, type Settings } from "../shared/Settings";

// ── XRSettingsScene ────────────────────────────────────────────────────────────
// uikit-based (see ui/settings.uikitml) — migrated off html2canvas as the Phase B
// pilot of the uikit migration plan (see ThreeCP/Analysis/WebXR_IWSDK.md Phase 7
// and ImplementationPlan.md). Both the keys and guitar sections live in the same
// static document; only their `display` property is toggled at runtime, rather
// than swapping DOM content in and out like the old innerHTML-based version.

const GUITAR_HIGHWAY_SCALE_MIN  = 0.25;
const GUITAR_HIGHWAY_SCALE_MAX  = 3;
const GUITAR_HIGHWAY_SCALE_STEP = 0.25;

const highwaySizeLabel = (v: number) =>
    (Math.round(v * 100) / 100).toString().replace(/\.?0+$/, '') + 'x';

const COLOR_PRESETS: { hex: string }[] = [
    { hex: '#2E71D6' },
    { hex: '#E33737' },
    { hex: '#3DAA3D' },
    { hex: '#9B59B6' },
    { hex: '#E67E22' },
    { hex: '#E8E8E8' },
];

export class XRSettingsScene {
    // Resolved once (the panel entity/document are created once and persist —
    // see settingsPanelEntity in index.ts), then reused across every show().
    private _doc: UIKitDocument | null = null;

    show(
        panelEntity: Entity,
        noteMin: number,
        noteMax: number,
        isGuitar: boolean,
        onDone: (s: Settings) => void,
    ): void {
        const s = { ...loadSettings() };

        const proceed = (doc: UIKitDocument) => {
            this._doc = doc;
            this._render(doc, s, noteMin, noteMax, isGuitar, onDone);
        };

        if (this._doc) { proceed(this._doc); return; }

        const poll = () => {
            const doc = panelEntity.getValue(PanelDocument, 'document') as UIKitDocument | null;
            if (doc) { proceed(doc); return; }
            setTimeout(poll, 100);
        };
        poll();
    }

    private _render(
        doc: UIKitDocument,
        s: Settings,
        _noteMin: number,
        _noteMax: number,
        isGuitar: boolean,
        onDone: (s: Settings) => void,
    ): void {
        const rerender = () => this._render(doc, s, _noteMin, _noteMax, isGuitar, onDone);

        this._setDisplay(doc, 'ss-keys-section',   !isGuitar);
        this._setDisplay(doc, 'ss-guitar-section',  isGuitar);

        this._setClick(doc, 'ss-back', () => {
            saveSettings(s);
            onDone(s);
        });

        // Shared across both sections — same underlying setting either way, but
        // distinct ids per section since both live in the document at once.
        const perfSuffix = isGuitar ? 'guitar' : 'keys';
        this._setToggle(doc, `ss-perftimeout-off-${perfSuffix}`, `ss-perftimeout-on-${perfSuffix}`,
            s.perfMenuTimeout, v => { s.perfMenuTimeout = v; rerender(); });

        if (isGuitar) {
            this._setToggle(doc, 'ss-invert-off',  'ss-invert-on',  s.invertStrings, v => { s.invertStrings = v; rerender(); });
            this._setToggle(doc, 'ss-lefty-off',   'ss-lefty-on',   s.leftyMode,     v => { s.leftyMode = v; rerender(); });
            // XR-specific setting — points at noteNumbersXR, not noteNumbersDesktop.
            this._setToggle(doc, 'ss-notenum-off', 'ss-notenum-on', s.noteNumbersXR, v => { s.noteNumbersXR = v; rerender(); });

            this._setClick(doc, 'ss-hwsize-dec', () => {
                s.guitarHighwayScale = Math.max(GUITAR_HIGHWAY_SCALE_MIN,
                    Math.round((s.guitarHighwayScale - GUITAR_HIGHWAY_SCALE_STEP) / GUITAR_HIGHWAY_SCALE_STEP) * GUITAR_HIGHWAY_SCALE_STEP);
                rerender();
            });
            this._setClick(doc, 'ss-hwsize-inc', () => {
                s.guitarHighwayScale = Math.min(GUITAR_HIGHWAY_SCALE_MAX,
                    Math.round((s.guitarHighwayScale + GUITAR_HIGHWAY_SCALE_STEP) / GUITAR_HIGHWAY_SCALE_STEP) * GUITAR_HIGHWAY_SCALE_STEP);
                rerender();
            });
            doc.getElementById('ss-hwsize-val')?.setProperties({ text: highwaySizeLabel(s.guitarHighwayScale) });
        } else {
            this._setToggle(doc, 'ss-note-range', 'ss-full-88', s.fullKeyboard,
                v => { s.fullKeyboard = v; rerender(); });

            COLOR_PRESETS.forEach((c, i) => {
                this._setSwatch(doc, `ss-rh-${i}`, s.keysRightHandColor === c.hex,
                    () => { s.keysRightHandColor = c.hex; rerender(); });
            });
            COLOR_PRESETS.forEach((c, i) => {
                this._setSwatch(doc, `ss-lh-${i}`, s.keysLeftHandColor === c.hex,
                    () => { s.keysLeftHandColor = c.hex; rerender(); });
            });
        }
    }

    private _setDisplay(doc: UIKitDocument, id: string, visible: boolean): void {
        doc.getElementById(id)?.setProperties({ display: visible ? 'flex' : 'none' });
    }

    private _setClick(doc: UIKitDocument, id: string, onClick: () => void): void {
        doc.getElementById(id)?.setProperties({ onClick });
    }

    private _setToggle(
        doc: UIKitDocument,
        offId: string,
        onId: string,
        value: boolean,
        onSet: (v: boolean) => void,
    ): void {
        const offEl = doc.getElementById(offId);
        const onEl  = doc.getElementById(onId);
        this._setActiveClass(offEl, !value);
        offEl?.setProperties({ onClick: () => onSet(false) });
        this._setActiveClass(onEl, value);
        onEl?.setProperties({ onClick: () => onSet(true) });
    }

    // classList.remove() warns ("Class '...' not found in the classList") if the
    // element doesn't currently have that class — guard with contains() first,
    // since these run on every re-render and each element only ever has one of
    // the two states at a time.
    private _setActiveClass(el: ReturnType<UIKitDocument['getElementById']>, active: boolean): void {
        if (!el) return;
        const addClass = active ? 'toggle-active' : 'toggle-inactive';
        const removeClass = active ? 'toggle-inactive' : 'toggle-active';
        if (el.classList.contains(removeClass)) el.classList.remove(removeClass);
        if (!el.classList.contains(addClass)) el.classList.add(addClass);
    }

    private _setSwatch(doc: UIKitDocument, id: string, selected: boolean, onClick: () => void): void {
        const el = doc.getElementById(id);
        if (selected) {
            if (!el?.classList.contains('swatch-selected')) el?.classList.add('swatch-selected');
        } else {
            if (el?.classList.contains('swatch-selected')) el?.classList.remove('swatch-selected');
        }
        el?.setProperties({ onClick });
    }
}
