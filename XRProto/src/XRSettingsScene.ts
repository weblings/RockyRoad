import type { XrButton } from "./XRTypes.js";
import { loadSettings, saveSettings, type Settings } from "./Settings.js";

// ── XRSettingsScene ────────────────────────────────────────────────────────────

const COLOR_PRESETS: { hex: string }[] = [
    { hex: '#2E71D6' },
    { hex: '#E33737' },
    { hex: '#3DAA3D' },
    { hex: '#9B59B6' },
    { hex: '#E67E22' },
    { hex: '#E8E8E8' },
];

export class XRSettingsScene {
    show(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        noteMin: number,
        noteMax: number,
        onDone: (s: Settings) => void,
    ): void {
        const s = { ...loadSettings() };
        const rerender = () => {
            xrButtons.length = 0;
            this._render(uiPanel, xrButtons, s, noteMin, noteMax, onDone, rerender);
        };
        rerender();
    }

    private _render(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        s: Settings,
        noteMin: number,
        noteMax: number,
        onDone: (s: Settings) => void,
        rerender: () => void,
    ): void {
        const toggleActive   = 'flex:1;padding:6px 8px;border:none;border-radius:4px;font-size:12px;cursor:pointer;background:#3a5a8a;color:#e8e8e8';
        const toggleInactive = 'flex:1;padding:6px 8px;border:none;border-radius:4px;font-size:12px;cursor:pointer;background:#333;color:#777';

        uiPanel.innerHTML = `
            <div style="padding:12px;font-family:sans-serif;color:#e8e8e8">
                <div style="font-size:13px;font-weight:bold;margin-bottom:10px">⚙ Settings</div>

                <div style="font-size:11px;color:#aaa;margin-bottom:5px">Key range</div>
                <div style="display:flex;gap:6px;margin-bottom:12px">
                    <button id="ss-note-range" style="${s.fullKeyboard ? toggleInactive : toggleActive}">
                        Note range
                    </button>
                    <button id="ss-full-88" style="${s.fullKeyboard ? toggleActive : toggleInactive}">
                        Full 88-key
                    </button>
                </div>

                <div style="font-size:11px;color:#aaa;margin-bottom:6px">Right hand</div>
                <div style="display:flex;gap:8px;margin-bottom:10px">
                    ${COLOR_PRESETS.map((c, i) => swatchHtml(c.hex, i, s.keysRightHandColor === c.hex, 'rh')).join('')}
                </div>

                <div style="font-size:11px;color:#aaa;margin-bottom:6px">Left hand</div>
                <div style="display:flex;gap:8px;margin-bottom:12px">
                    ${COLOR_PRESETS.map((c, i) => swatchHtml(c.hex, i, s.keysLeftHandColor === c.hex, 'lh')).join('')}
                </div>

                <button id="ss-done" style="display:block;width:100%;padding:9px;border:none;
                    border-radius:5px;font-size:13px;cursor:pointer;background:#3a6a3a;
                    color:#111;box-sizing:border-box">
                    ✓ Done
                </button>
            </div>
        `;

        // Key range toggle
        xrButtons.push({
            el: uiPanel.querySelector('#ss-note-range') as HTMLButtonElement,
            onClick: () => { s.fullKeyboard = false; rerender(); },
        });
        xrButtons.push({
            el: uiPanel.querySelector('#ss-full-88') as HTMLButtonElement,
            onClick: () => { s.fullKeyboard = true; rerender(); },
        });

        // Right hand swatches
        COLOR_PRESETS.forEach((c, i) => {
            xrButtons.push({
                el: uiPanel.querySelector(`#ss-rh-${i}`) as HTMLElement,
                onClick: () => { s.keysRightHandColor = c.hex; rerender(); },
            });
        });

        // Left hand swatches
        COLOR_PRESETS.forEach((c, i) => {
            xrButtons.push({
                el: uiPanel.querySelector(`#ss-lh-${i}`) as HTMLElement,
                onClick: () => { s.keysLeftHandColor = c.hex; rerender(); },
            });
        });

        xrButtons.push({
            el: uiPanel.querySelector('#ss-done') as HTMLButtonElement,
            onClick: () => {
                saveSettings(s);
                onDone(s);
            },
        });
    }
}

function swatchHtml(hex: string, i: number, selected: boolean, hand: string): string {
    const border = selected ? 'border:3px solid #ffffff' : 'border:3px solid transparent';
    return `<div id="ss-${hand}-${i}" style="width:30px;height:30px;border-radius:50%;` +
           `background:${hex};cursor:pointer;box-sizing:border-box;${border}"></div>`;
}
