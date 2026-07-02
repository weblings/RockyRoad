import type { XrButton } from "./XRTypes";
import type { SourcedEntry } from "../shared/SongSource";

// ── Sort options ──────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
    { value: 'title-asc',       label: 'Title A–Z' },
    { value: 'title-desc',      label: 'Title Z–A' },
    { value: 'artist-asc',      label: 'Artist A–Z' },
    { value: 'artist-desc',     label: 'Artist Z–A' },
    { value: 'difficulty-asc',  label: 'Difficulty ↑' },
    { value: 'difficulty-desc', label: 'Difficulty ↓' },
    { value: 'tuning-asc',      label: 'Tuning A–Z' },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]['value'];

// ── XRSongLibrary ─────────────────────────────────────────────────────────────

export class XRSongLibrary {
    private entries: SourcedEntry[];
    private sortKey: SortValue = 'title-asc';
    private filterKey: 'all' | 'lead' = 'all';
    private sortOpen = false;

    constructor(entries: SourcedEntry[]) {
        this.entries = entries;
    }

    show(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        onSelect: (sourced: SourcedEntry) => void,
    ): void {
        xrButtons.length = 0;
        this._render(uiPanel, xrButtons, onSelect);
    }

    private _render(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        onSelect: (sourced: SourcedEntry) => void,
    ): void {
        const rerender = (): void => {
            xrButtons.length = 0;
            this._render(uiPanel, xrButtons, onSelect);
        };

        const currentLabel = SORT_OPTIONS.find(o => o.value === this.sortKey)?.label ?? 'Title A–Z';
        const displayEntries = this._getFiltered();

        uiPanel.innerHTML = `
            <div class="library-frame">
                <div class="toolbar">
                    <div class="search-row">
                        <div class="search-input"><span class="search-placeholder">Search...</span></div>
                        <div class="sort-dropdown${this.sortOpen ? ' open' : ''}">
                            <button class="sort-trigger" id="sort-trigger" type="button">
                                <span class="sort-label">${currentLabel}</span>
                                <span class="sort-chevron">&#9662;</span>
                            </button>
                            <div class="sort-menu">
                                ${SORT_OPTIONS.map(o =>
                                    `<button class="sort-option${o.value === this.sortKey ? ' selected' : ''}"
                                        id="sort-opt-${o.value}" type="button">${o.label}</button>`
                                ).join('')}
                            </div>
                        </div>
                        <button class="button primary-dark" id="exit-vr"
                                style="margin-left:auto;padding:9px 14px;border-radius:6px;font-size:13px;font-family:inherit;white-space:nowrap" type="button">Exit VR</button>
                    </div>
                    <div class="filter-row">
                        <button id="filter-all" class="button ${this.filterKey === 'all' ? 'primary-light' : 'primary-dark'}" type="button">All</button>
                        <button id="filter-lead" class="button ${this.filterKey === 'lead' ? 'primary-light' : 'primary-dark'}" type="button">Lead</button>
                    </div>
                </div>
                <div class="song-list">
                    ${displayEntries.length === 0
                        ? '<p style="color:#555;font-size:13px;padding:8px">No songs found.</p>'
                        : displayEntries.map((s, i) => {
                            const artUrl = s.source.getAlbumArtUrl(s.entry);
                            const artEl = artUrl
                                ? `<img class="song-art" src="${esc(artUrl)}" alt="" />`
                                : `<div class="art-placeholder"></div>`;
                            return `
                            <button class="song-entry" id="song-${i}" type="button">
                                ${artEl}
                                <div class="song-meta">
                                    <p class="song-title">${esc(s.entry.songName)}</p>
                                    <p class="song-album"></p>
                                    <p class="song-artist">${esc(s.entry.artistName)}</p>
                                </div>
                            </button>`;
                        }).join('')}
                </div>
            </div>
        `;

        // Exit VR button — navigates back to desktop.html.
        xrButtons.push({
            el: uiPanel.querySelector('#exit-vr') as HTMLButtonElement,
            onClick: () => { location.href = 'desktop.html'; },
        });

        // Sort trigger — toggles the dropdown open/closed.
        xrButtons.push({
            el: uiPanel.querySelector('#sort-trigger') as HTMLButtonElement,
            onClick: () => { this.sortOpen = !this.sortOpen; rerender(); },
        });

        // Sort option buttons — selecting one applies sort and closes dropdown.
        for (const opt of SORT_OPTIONS) {
            const el = uiPanel.querySelector(`#sort-opt-${opt.value}`) as HTMLButtonElement | null;
            if (!el) continue;
            const value = opt.value;
            xrButtons.push({
                el,
                onClick: () => {
                    this.sortKey  = value;
                    this.sortOpen = false;
                    rerender();
                },
            });
        }

        // Filter chips.
        xrButtons.push({
            el: uiPanel.querySelector('#filter-all') as HTMLButtonElement,
            onClick: () => { this.filterKey = 'all'; rerender(); },
        });
        xrButtons.push({
            el: uiPanel.querySelector('#filter-lead') as HTMLButtonElement,
            onClick: () => { this.filterKey = 'lead'; rerender(); },
        });

        // Song entry buttons.
        for (let i = 0; i < displayEntries.length; i++) {
            const sourced = displayEntries[i];
            const el = uiPanel.querySelector(`#song-${i}`) as HTMLButtonElement | null;
            if (!el) continue;
            xrButtons.push({ el, onClick: () => onSelect(sourced) });
        }
    }

    private _getFiltered(): SourcedEntry[] {
        const filtered = this.filterKey === 'lead'
            ? this.entries.filter(s => s.entry.parts.some(p => p.type === 'Keys'))
            : this.entries;
        return this._sorted(filtered);
    }

    private _sorted(entries: SourcedEntry[]): SourcedEntry[] {
        const copy = [...entries];
        switch (this.sortKey) {
            case 'title-asc':       copy.sort((a, b) => a.entry.songName.localeCompare(b.entry.songName));     break;
            case 'title-desc':      copy.sort((a, b) => b.entry.songName.localeCompare(a.entry.songName));     break;
            case 'artist-asc':      copy.sort((a, b) => a.entry.artistName.localeCompare(b.entry.artistName)); break;
            case 'artist-desc':     copy.sort((a, b) => b.entry.artistName.localeCompare(a.entry.artistName)); break;
            default:                copy.sort((a, b) => a.entry.songName.localeCompare(b.entry.songName));     break;
        }
        return copy;
    }
}

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
