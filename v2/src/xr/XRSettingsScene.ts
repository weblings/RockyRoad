import type { XrButton } from "./XRTypes";
import { loadSettings, saveSettings, type Settings } from "../shared/Settings";
import { setupScrollList } from "./XRScrollList";

// ── XRSettingsScene ────────────────────────────────────────────────────────────

const GUITAR_HIGHWAY_SCALE_MIN  = 0.25;
const GUITAR_HIGHWAY_SCALE_MAX  = 3;
const GUITAR_HIGHWAY_SCALE_STEP = 0.25;

const highwaySizeLabel = (v: number) =>
    (Math.round(v * 100) / 100).toString().replace(/\.?0+$/, '') + '×';

const COLOR_PRESETS: { hex: string }[] = [
    { hex: '#2E71D6' },
    { hex: '#E33737' },
    { hex: '#3DAA3D' },
    { hex: '#9B59B6' },
    { hex: '#E67E22' },
    { hex: '#E8E8E8' },
];

export class XRSettingsScene {
    // Persists across rerenders (every toggle/stepper click rebuilds the DOM
    // from scratch, which would otherwise reset scroll to the top on each click).
    private _scrollOffset = 0;

    show(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        noteMin: number,
        noteMax: number,
        isGuitar: boolean,
        onDone: (s: Settings) => void,
    ): void {
        const s = { ...loadSettings() };
        const rerender = () => {
            xrButtons.length = 0;
            this._render(uiPanel, xrButtons, s, noteMin, noteMax, isGuitar, onDone, rerender);
        };
        rerender();
    }

    private _render(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        s: Settings,
        _noteMin: number,
        _noteMax: number,
        isGuitar: boolean,
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
                    <div class="settings-area">
                        <div class="settings-viewport" id="ss-viewport">
                            <div class="settings-body" id="ss-body">
                                ${isGuitar ? this._guitarSectionHtml(s) : this._keysSectionHtml(s)}
                            </div>
                        </div>
                        <div class="scroll-track" id="ss-scroll-track">
                            <div class="scroll-bar"></div>
                            <div class="scroll-thumb" id="ss-scroll-thumb"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        xrButtons.push({
            el: uiPanel.querySelector('#ss-back') as HTMLButtonElement,
            onClick: () => {
                saveSettings(s);
                onDone(s);
            },
        });

        setupScrollList({
            viewport: uiPanel.querySelector<HTMLElement>('#ss-viewport')!,
            inner:    uiPanel.querySelector<HTMLElement>('#ss-body')!,
            track:    uiPanel.querySelector<HTMLElement>('#ss-scroll-track')!,
            thumb:    uiPanel.querySelector<HTMLElement>('#ss-scroll-thumb')!,
            initialOffset:  this._scrollOffset,
            onOffsetChange: (o) => { this._scrollOffset = o; },
        }, xrButtons);

        // Shared across both sections — same underlying setting either way.
        this._registerToggle(uiPanel, xrButtons, 'ss-perftimeout', v => { s.perfMenuTimeout = v; rerender(); });

        if (isGuitar) {
            this._registerToggle(uiPanel, xrButtons, 'ss-invert', v => { s.invertStrings = v; rerender(); });
            this._registerToggle(uiPanel, xrButtons, 'ss-lefty',  v => { s.leftyMode     = v; rerender(); });
            // XR-specific setting — points at noteNumbersXR, not noteNumbersDesktop.
            this._registerToggle(uiPanel, xrButtons, 'ss-notenum', v => { s.noteNumbersXR = v; rerender(); });
            xrButtons.push({
                el: uiPanel.querySelector('#ss-hwsize-dec') as HTMLButtonElement,
                onClick: () => {
                    s.guitarHighwayScale = Math.max(GUITAR_HIGHWAY_SCALE_MIN,
                        Math.round((s.guitarHighwayScale - GUITAR_HIGHWAY_SCALE_STEP) / GUITAR_HIGHWAY_SCALE_STEP) * GUITAR_HIGHWAY_SCALE_STEP);
                    rerender();
                },
            });
            xrButtons.push({
                el: uiPanel.querySelector('#ss-hwsize-inc') as HTMLButtonElement,
                onClick: () => {
                    s.guitarHighwayScale = Math.min(GUITAR_HIGHWAY_SCALE_MAX,
                        Math.round((s.guitarHighwayScale + GUITAR_HIGHWAY_SCALE_STEP) / GUITAR_HIGHWAY_SCALE_STEP) * GUITAR_HIGHWAY_SCALE_STEP);
                    rerender();
                },
            });
        } else {
            xrButtons.push({
                el: uiPanel.querySelector('#ss-note-range') as HTMLButtonElement,
                onClick: () => { s.fullKeyboard = false; rerender(); },
            });
            xrButtons.push({
                el: uiPanel.querySelector('#ss-full-88') as HTMLButtonElement,
                onClick: () => { s.fullKeyboard = true; rerender(); },
            });

            COLOR_PRESETS.forEach((c, i) => {
                xrButtons.push({
                    el: uiPanel.querySelector(`#ss-rh-${i}`) as HTMLElement,
                    onClick: () => { s.keysRightHandColor = c.hex; rerender(); },
                });
            });

            COLOR_PRESETS.forEach((c, i) => {
                xrButtons.push({
                    el: uiPanel.querySelector(`#ss-lh-${i}`) as HTMLElement,
                    onClick: () => { s.keysLeftHandColor = c.hex; rerender(); },
                });
            });
        }
    }

    private _keysSectionHtml(s: Settings): string {
        return `
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
            ${toggleRowHtml('ss-perftimeout', '(Perf) Menu Timeout', s.perfMenuTimeout)}
        `;
    }

    private _guitarSectionHtml(s: Settings): string {
        return `
            ${toggleRowHtml('ss-invert',  'Invert Strings', s.invertStrings)}
            ${toggleRowHtml('ss-lefty',   'Lefty Mode',     s.leftyMode)}
            ${toggleRowHtml('ss-notenum', 'Note Numbers',   s.noteNumbersXR)}
            <div class="setting-row">
                <p class="setting-title">Highway Size</p>
            </div>
            <div class="speed-row">
                <button id="ss-hwsize-dec" class="button secondary-dark speed-btn" type="button">−</button>
                <span id="ss-hwsize-val" class="speed-value">${highwaySizeLabel(s.guitarHighwayScale)}</span>
                <button id="ss-hwsize-inc" class="button secondary-dark speed-btn" type="button">+</button>
            </div>
            ${toggleRowHtml('ss-perftimeout', '(Perf) Menu Timeout', s.perfMenuTimeout)}
        `;
    }

    private _registerToggle(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        id: string,
        onSet: (v: boolean) => void,
    ): void {
        xrButtons.push({
            el: uiPanel.querySelector(`#${id}-off`) as HTMLButtonElement,
            onClick: () => onSet(false),
        });
        xrButtons.push({
            el: uiPanel.querySelector(`#${id}-on`) as HTMLButtonElement,
            onClick: () => onSet(true),
        });
    }
}

function toggleRowHtml(id: string, label: string, value: boolean): string {
    return `
        <div class="setting-row">
            <p class="setting-title">${label}</p>
        </div>
        <div class="toggle-group">
            <button id="${id}-off" class="button ${!value ? 'primary-light' : 'primary-dark'}" type="button">Off</button>
            <button id="${id}-on" class="button ${value ? 'primary-light' : 'primary-dark'}" type="button">On</button>
        </div>
    `;
}

function swatchHtml(hex: string, i: number, selected: boolean, hand: string): string {
    return `<div id="ss-${hand}-${i}" class="color-swatch${selected ? ' selected' : ''}" style="background: ${hex};"></div>`;
}
