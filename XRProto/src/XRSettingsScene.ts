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
        _noteMin: number,
        _noteMax: number,
        onDone: (s: Settings) => void,
        rerender: () => void,
    ): void {
        uiPanel.innerHTML = `
            <div class="frame">
                <div class="content">
                    <div class="header">
                        <button id="ss-back" class="button primary-dark" type="button">
                            <span class="back-icon">←</span>
                            <span class="back-label">Play</span>
                        </button>
                    </div>
                    <div class="settings-body">
                        <div class="setting-row">
                            <p class="setting-title">Key Range</p>
                        </div>
                        <div class="toggle-group">
                            <button id="ss-note-range" class="button ${s.fullKeyboard ? 'primary-dark' : 'primary-light'}" type="button">Note range</button>
                            <button id="ss-full-88" class="button ${s.fullKeyboard ? 'primary-light' : 'primary-dark'}" type="button">Full 88-key</button>
                        </div>
                        <div class="setting-row">
                            <p class="setting-title">Right Hand Color</p>
                        </div>
                        <div class="swatch-row">
                            ${COLOR_PRESETS.map((c, i) => swatchHtml(c.hex, i, s.keysRightHandColor === c.hex, 'rh')).join('')}
                        </div>
                        <div class="setting-row">
                            <p class="setting-title">Left Hand Color</p>
                        </div>
                        <div class="swatch-row">
                            ${COLOR_PRESETS.map((c, i) => swatchHtml(c.hex, i, s.keysLeftHandColor === c.hex, 'lh')).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Back button — saves and returns to active scene.
        xrButtons.push({
            el: uiPanel.querySelector('#ss-back') as HTMLButtonElement,
            onClick: () => {
                saveSettings(s);
                onDone(s);
            },
        });

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
    }
}

function swatchHtml(hex: string, i: number, selected: boolean, hand: string): string {
    return `<div id="ss-${hand}-${i}" class="color-swatch${selected ? ' selected' : ''}" style="background: ${hex};"></div>`;
}
