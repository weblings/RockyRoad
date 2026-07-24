import type { XrButton } from "./XRTypes";
import type { SourcedEntry } from "../shared/SongSource";
import { setupScrollList } from "./XRScrollList";

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

const SEARCH_INPUT_ID = 'xr-lib-search-real';

// ── XRSongLibrary ─────────────────────────────────────────────────────────────

export class XRSongLibrary {
    private entries: SourcedEntry[];
    private sortKey: SortValue = 'title-asc';
    private filterKey: 'all' | 'lead' = 'all';
    private sortOpen = false;
    private searchQuery = '';

    constructor(entries: SourcedEntry[]) {
        this.entries = entries;
    }

    show(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        onSelect: (sourced: SourcedEntry) => void,
        onInvalidate: () => void,
    ): void {
        xrButtons.length = 0;
        this._render(uiPanel, xrButtons, onSelect, onInvalidate);
    }

    private _render(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        onSelect: (sourced: SourcedEntry) => void,
        onInvalidate: () => void,
    ): void {
        const rerender = (): void => {
            xrButtons.length = 0;
            this._render(uiPanel, xrButtons, onSelect, onInvalidate);
        };

        // Real input lives in document.body so the Quest IME initialises on focus.
        document.getElementById(SEARCH_INPUT_ID)?.remove();
        const searchReal = document.createElement('input');
        searchReal.type = 'text';
        searchReal.id   = SEARCH_INPUT_ID;
        searchReal.style.cssText =
            'position:fixed;left:0;top:0;width:100%;height:44px;font-size:16px;opacity:0;pointer-events:none;';
        searchReal.value = this.searchQuery;
        document.body.appendChild(searchReal);

        const currentLabel = SORT_OPTIONS.find(o => o.value === this.sortKey)?.label ?? 'Title A–Z';
        const displayEntries = this._getFiltered();

        uiPanel.innerHTML = `
            <div class="library-frame">
                <div class="toolbar">
                    <div class="search-row">
                        <div class="search-input" id="lib-search-display">
                            <span class="${this.searchQuery ? 'search-text' : 'search-placeholder'}">${this.searchQuery ? esc(this.searchQuery) : 'Search…'}</span>
                        </div>
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
                                style="padding:9px 14px;border-radius:6px;font-size:13px;font-family:inherit;white-space:nowrap" type="button">Exit VR</button>
                    </div>
                    <div class="filter-row">
                        <button id="filter-all" class="button ${this.filterKey === 'all' ? 'primary-light' : 'primary-dark'}" type="button">All</button>
                        <button id="filter-lead" class="button ${this.filterKey === 'lead' ? 'primary-light' : 'primary-dark'}" type="button">Lead</button>
                    </div>
                </div>
                <div class="song-list-area">
                    <div class="song-list-viewport" id="lib-song-viewport">
                        <div class="song-list-inner" id="lib-song-inner">
                            ${this._songListHtml(displayEntries)}
                        </div>
                    </div>
                    <div class="scroll-track" id="lib-scroll-track">
                        <div class="scroll-bar"></div>
                        <div class="scroll-thumb" id="lib-scroll-thumb"></div>
                    </div>
                </div>
            </div>
        `;

        // ── Scroll state ──────────────────────────────────────────────────────

        const inner    = uiPanel.querySelector<HTMLElement>('#lib-song-inner')!;
        const viewport = uiPanel.querySelector<HTMLElement>('#lib-song-viewport')!;
        const thumb    = uiPanel.querySelector<HTMLElement>('#lib-scroll-thumb')!;
        const track    = uiPanel.querySelector<HTMLElement>('#lib-scroll-track')!;

        const scrollList = setupScrollList({ viewport, inner, track, thumb }, xrButtons);

        // ── Toolbar buttons ───────────────────────────────────────────────────

        xrButtons.push({
            el: uiPanel.querySelector('#exit-vr') as HTMLButtonElement,
            onClick: () => { location.href = 'desktop.html'; },
        });

        xrButtons.push({
            el: uiPanel.querySelector('#sort-trigger') as HTMLButtonElement,
            onClick: () => { this.sortOpen = !this.sortOpen; rerender(); },
        });

        for (const opt of SORT_OPTIONS) {
            const el = uiPanel.querySelector(`#sort-opt-${opt.value}`) as HTMLButtonElement | null;
            if (!el) continue;
            const value = opt.value;
            xrButtons.push({
                el,
                onClick: () => { this.sortKey = value; this.sortOpen = false; rerender(); },
            });
        }

        xrButtons.push({
            el: uiPanel.querySelector('#filter-all') as HTMLButtonElement,
            onClick: () => { this.filterKey = 'all'; rerender(); },
        });
        xrButtons.push({
            el: uiPanel.querySelector('#filter-lead') as HTMLButtonElement,
            onClick: () => { this.filterKey = 'lead'; rerender(); },
        });

        // ── Search ────────────────────────────────────────────────────────────

        const searchDisplay = uiPanel.querySelector<HTMLElement>('#lib-search-display')!;
        xrButtons.push({
            el: searchDisplay,
            onClick: () => {
                // LIMITATION: Quest's IME composing buffer is cleared when the keyboard
                // dismisses and cannot be reliably repopulated on re-focus via JS, so
                // re-opening the keyboard always starts from an empty state. Clearing
                // the query on each open is the pragmatic workaround until a native
                // XR text-input API is available.
                this.searchQuery = '';
                searchReal.value = '';
                const textEl = searchDisplay.querySelector('span');
                if (textEl) { textEl.textContent = 'Search…'; textEl.className = 'search-placeholder'; }
                const innerEl = uiPanel.querySelector<HTMLElement>('#lib-song-inner');
                if (innerEl) {
                    const entries = this._getFiltered();
                    innerEl.innerHTML = this._songListHtml(entries);
                    xrButtons.splice(songButtonOffset);
                    this._registerSongButtons(uiPanel, xrButtons, entries, onSelect);
                    scrollList.recompute(true);
                }
                searchReal.focus();
            },
        });

        const songButtonOffset = xrButtons.length;
        this._registerSongButtons(uiPanel, xrButtons, displayEntries, onSelect);

        // Partial refresh on keystroke — updates the visual span and song grid
        // without rebuilding the toolbar, so the real input keeps focus.
        searchReal.addEventListener('input', () => {
            this.searchQuery = searchReal.value;
            const textEl = searchDisplay.querySelector('span');
            if (textEl) {
                textEl.textContent = this.searchQuery || 'Search…';
                textEl.className   = this.searchQuery ? 'search-text' : 'search-placeholder';
            }
            const innerEl = uiPanel.querySelector<HTMLElement>('#lib-song-inner');
            if (!innerEl) return;
            const entries = this._getFiltered();
            innerEl.innerHTML = this._songListHtml(entries);
            xrButtons.splice(songButtonOffset);
            this._registerSongButtons(uiPanel, xrButtons, entries, onSelect);
            scrollList.recompute(true);
            onInvalidate();
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private _songListHtml(entries: SourcedEntry[]): string {
        if (entries.length === 0)
            return '<p style="color:#555;font-size:13px;padding:8px">No songs found.</p>';
        return entries.map((s, i) => {
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
        }).join('');
    }

    private _registerSongButtons(
        uiPanel: HTMLDivElement,
        xrButtons: XrButton[],
        entries: SourcedEntry[],
        onSelect: (sourced: SourcedEntry) => void,
    ): void {
        for (let i = 0; i < entries.length; i++) {
            const sourced = entries[i];
            const el = uiPanel.querySelector<HTMLButtonElement>(`#song-${i}`);
            if (!el) continue;
            xrButtons.push({ el, onClick: () => onSelect(sourced) });
        }
    }

    private _getFiltered(): SourcedEntry[] {
        const q = this.searchQuery.toLowerCase();
        let filtered = this.filterKey === 'lead'
            ? this.entries.filter(s => s.entry.parts.some(p => p.type === 'Keys'))
            : this.entries;
        if (q) {
            filtered = filtered.filter(s => {
                const hay = `${s.entry.songName} ${s.entry.artistName} ${s.entry.albumName ?? ''}`.toLowerCase();
                return hay.includes(q);
            });
        }
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
