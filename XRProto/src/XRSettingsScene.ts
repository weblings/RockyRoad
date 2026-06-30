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
                        <button id="ss-back" class="button primary-dark icon-btn" type="button">
                            <svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.0908 14.3334C12.972 14.3334 12.9125 14.1898 12.9965 14.1058L17.7021 9.40022C17.9625 9.13987 17.9625 8.71776 17.7021 8.45741L16.2879 7.04319C16.0275 6.78284 15.6054 6.78284 15.3451 7.04319L6.8598 15.5285C6.59945 15.7888 6.59945 16.2109 6.8598 16.4713L8.27401 17.8855L8.27536 17.8868L15.3453 24.9568C15.6057 25.2172 16.0278 25.2172 16.2881 24.9568L17.7024 23.5426C17.9627 23.2822 17.9627 22.8601 17.7024 22.5998L12.9969 17.8944C12.9129 17.8104 12.9724 17.6668 13.0912 17.6668L26 17.6668C26.3682 17.6668 26.6667 17.3683 26.6667 17.0001V15.0001C26.6667 14.6319 26.3682 14.3334 26 14.3334L13.0908 14.3334Z" fill="currentColor"/></svg>
                            <span>Play</span>
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
