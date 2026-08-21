import * as THREE from "three";
import type { App, IScreen } from "./App";
import { loadAllSources, type SourcedEntry } from "../shared/SongSource";
import { loadSettings } from "../shared/Settings";
import { PreSceneScreen } from "./PreSceneScreen";
import { Dropdown, type DropdownOption } from "./Dropdown";

// ── Types ─────────────────────────────────────────────────────────────────────

type InstrumentFilter = 'All' | 'Lead' | 'Rhythm' | 'Bass' | 'Keys' | 'Drums';
type SortOption =
    | 'title-asc' | 'title-desc'
    | 'artist-asc' | 'artist-desc'
    | 'difficulty-asc' | 'difficulty-desc'
    | 'tuning-asc';

interface LibraryState {
    sort: SortOption;
    instrumentFilter: InstrumentFilter;
    tuningFilter: string;
    searchQuery: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INSTRUMENT_TYPE: Record<InstrumentFilter, string> = {
    All: '', Lead: 'LeadGuitar', Rhythm: 'RhythmGuitar',
    Bass: 'BassGuitar', Keys: 'Keys', Drums: 'Drums',
};
const STRINGED = new Set(['LeadGuitar', 'RhythmGuitar', 'BassGuitar']);

// Instrument badges shown on each library card, in display order. No Drums entry —
// unsupported everywhere in this app, so there's no badge for it to show.
const BADGE_LABELS: { types: string[]; label: string }[] = [
    { types: ['BassGuitar'],                 label: 'Bass' },
    { types: ['Keys'],                       label: 'Keys' },
    { types: ['LeadGuitar', 'RhythmGuitar'], label: 'Guitar' },
];
const STATE_KEY = 'chartplayer-library-state';
const DEFAULT_STATE: LibraryState = {
    sort: 'title-asc', instrumentFilter: 'All', tuningFilter: 'All', searchQuery: '',
};

const SORT_LABELS: Record<string, string> = {
    'title-asc': 'Title A–Z', 'title-desc': 'Title Z–A',
    'artist-asc': 'Artist A–Z', 'artist-desc': 'Artist Z–A',
    'difficulty-asc': 'Difficulty ↑', 'difficulty-desc': 'Difficulty ↓',
    'tuning-asc': 'Tuning A–Z',
};

// ── SongLibraryScreen ─────────────────────────────────────────────────────────

export class SongLibraryScreen implements IScreen {
    private app: App;
    private texture: THREE.Texture;
    private container: HTMLElement | null = null;
    private songs: SourcedEntry[] = [];
    private state: LibraryState;
    private sortDropdown: Dropdown | null = null;

    constructor(app: App, texture: THREE.Texture) {
        this.app = app;
        this.texture = texture;
        this.state = loadState();
    }

    async mount(container: HTMLElement): Promise<void> {
        this.container = container;
        this.renderLoading();
        const { remoteServerUrl } = loadSettings();
        this.songs = await loadAllSources(remoteServerUrl);
        this.renderLibrary();
    }

    unmount(): void {
        this.sortDropdown?.destroy();
        this.sortDropdown = null;
        if (this.container) this.container.innerHTML = '';
        this.container = null;
    }

    // ── Render states ─────────────────────────────────────────────────────────

    private renderLoading(): void {
        this.setContent(`
            <div class="lib-splash">
                <div class="lib-splash-inner">
                    <p class="lib-subtitle">Loading library…</p>
                </div>
            </div>`);
    }

    private renderLibrary(): void {
        const knownTypes = new Set(Object.values(INSTRUMENT_TYPE).filter(Boolean));
        const presentTypes = new Set<string>();
        for (const { entry } of this.songs)
            for (const p of entry.parts)
                if (knownTypes.has(p.type)) presentTypes.add(p.type);

        const chips: InstrumentFilter[] = ['All'];
        for (const [filter, type] of Object.entries(INSTRUMENT_TYPE)) {
            if (filter !== 'All' && presentTypes.has(type)) chips.push(filter as InstrumentFilter);
        }

        if (this.state.instrumentFilter !== 'All' && !chips.includes(this.state.instrumentFilter)) {
            this.state.instrumentFilter = 'All';
            this.state.tuningFilter = 'All';
        }

        const typeFilter = INSTRUMENT_TYPE[this.state.instrumentFilter];
        const isStringed = STRINGED.has(typeFilter);
        const isFiltered = this.state.instrumentFilter !== 'All';

        // Full-container rebuild (this method) discards the old Dropdown's DOM along with
        // everything else — snapshot its open state and evict it from the static registry first.
        const sortWasOpen = this.sortDropdown?.isOpen ?? false;
        this.sortDropdown?.destroy();

        this.setContent(`
            <div class="lib-screen">
                <div class="lib-bar">
                    <div class="lib-search-row">
                        <input class="lib-search" id="lib-search" type="text"
                            placeholder="Search songs, artists, albums…"
                            value="${esc(this.state.searchQuery)}" />
                        <div id="lib-sort-slot"></div>
                        <button id="enter-vr" class="dropdown-trigger" style="display:none"
                                type="button" onclick="location.href='xr.html'">Enter VR</button>
                    </div>
                    <div class="lib-filter-row">
                        <div id="lib-chips">
                            ${chips.map(f => `
                                <button class="lib-filter-btn ${f === this.state.instrumentFilter ? 'active' : 'inactive'}"
                                    data-filter="${f}" type="button">${f}</button>
                            `).join('')}
                        </div>
                        ${isStringed ? this.buildTuningSelect(typeFilter) : ''}
                    </div>
                    ${import.meta.env.VITE_DEMO_MODE === 'true' ? `
                        <p class="lib-browser-note">
                            <strong>DEMO:</strong> To play more songs: 1)
                            <a href="https://github.com/weblings/RockyRoadImport" target="_blank" rel="noopener noreferrer">Convert songs to OpenSongFormat</a>,
                            2) <a href="https://github.com/weblings/RockyRoad" target="_blank" rel="noopener noreferrer">Self-host RockyRoad</a>
                            and point its server to your converted songs.
                        </p>` : ''}
                </div>
                <div class="lib-song-list" id="lib-grid"></div>
            </div>`);

        // Show "Enter VR" button if browser supports immersive-vr
        if ('xr' in navigator) {
            navigator.xr!.isSessionSupported('immersive-vr').then(supported => {
                if (supported) {
                    const btn = this.container?.querySelector<HTMLElement>('#enter-vr');
                    if (btn) btn.style.display = '';
                }
            });
        }

        const search = this.container!.querySelector<HTMLInputElement>('#lib-search')!;
        search.addEventListener('input', () => {
            this.state.searchQuery = search.value;
            saveState(this.state);
            this.refreshCards();
        });

        const sortSlot = this.container!.querySelector<HTMLElement>('#lib-sort-slot')!;
        this.sortDropdown = new Dropdown(sortSlot, SORT_LABELS[this.state.sort] ?? 'Title A–Z', (value) => {
            this.state.sort = value as SortOption;
            saveState(this.state);
            this.sortDropdown!.setTriggerLabel(SORT_LABELS[value] ?? '');
            this.sortDropdown!.setOptions(this.buildSortOptions(isFiltered, isStringed));
            this.refreshCards();
        });
        this.sortDropdown.setOptions(this.buildSortOptions(isFiltered, isStringed));
        if (sortWasOpen) this.sortDropdown.openMenu();

        this.container!.querySelector('#lib-chips')!.addEventListener('click', e => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-filter]');
            if (!btn) return;
            this.state.instrumentFilter = btn.dataset.filter as InstrumentFilter;
            this.state.tuningFilter = 'All';
            saveState(this.state);
            this.renderLibrary();
        });

        if (isStringed) {
            const tuningSel = this.container!.querySelector<HTMLSelectElement>('#lib-tuning');
            tuningSel?.addEventListener('change', () => {
                this.state.tuningFilter = tuningSel.value;
                saveState(this.state);
                this.refreshCards();
            });
        }

        this.container!.querySelector('#lib-grid')!.addEventListener('click', e => {
            const card = (e.target as HTMLElement).closest<HTMLElement>('[data-song-idx]');
            if (!card) return;
            this.onSongClick(this.songs[parseInt(card.dataset.songIdx!)]);
        });

        this.refreshCards();
    }

    // ── Filtering + card rendering ────────────────────────────────────────────

    private refreshCards(): void {
        const grid = this.container?.querySelector<HTMLElement>('#lib-grid');
        if (!grid) return;

        const filtered = this.filteredSongs();

        grid.innerHTML = filtered.map(({ sourced, origIdx }) => {
            const artUrl = sourced.source.getAlbumArtUrl(sourced.entry);
            const badges = this.instrumentBadges(sourced.entry);
            return `
                <button class="lib-song-entry" data-song-idx="${origIdx}" type="button">
                    <div class="lib-art-thumb">
                        ${artUrl ? `<img src="${esc(artUrl)}" alt="" onerror="this.style.display='none'" />` : ''}
                    </div>
                    <div class="lib-song-meta">
                        <p class="lib-song-title">${esc(sourced.entry.songName)}</p>
                        <p class="lib-song-album">${esc(sourced.entry.albumName ?? '')}</p>
                        <p class="lib-song-artist">${esc(sourced.entry.artistName)}</p>
                    </div>
                    ${badges.length ? `
                        <div class="lib-instrument-badges">
                            ${badges.map(b => `<span class="lib-badge">${esc(b.label)}</span>`).join('')}
                        </div>` : ''}
                </button>`;
        }).join('');
    }

    // Which instrument badges apply to a song, in BADGE_LABELS' display order.
    private instrumentBadges(entry: SourcedEntry['entry']): { label: string }[] {
        const partTypes = new Set(entry.parts.map(p => p.type));
        return BADGE_LABELS.filter(b => b.types.some(t => partTypes.has(t)));
    }

    private filteredSongs(): { sourced: SourcedEntry; origIdx: number }[] {
        const q = this.state.searchQuery.toLowerCase();
        const typeFilter = INSTRUMENT_TYPE[this.state.instrumentFilter];

        const result = this.songs
            .map((sourced, origIdx) => ({ sourced, origIdx }))
            .filter(({ sourced: { entry } }) => {
                if (typeFilter && !entry.parts.some(p => p.type === typeFilter)) return false;
                if (this.state.tuningFilter !== 'All') {
                    const part = entry.parts.find(p => p.type === typeFilter);
                    if (!part || part.tuning !== this.state.tuningFilter) return false;
                }
                if (q) {
                    const hay = `${entry.songName} ${entry.artistName} ${entry.albumName ?? ''}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });

        result.sort((a, b) => {
            const ae = a.sourced.entry, be = b.sourced.entry;
            switch (this.state.sort) {
                case 'title-asc':        return ae.songName.localeCompare(be.songName);
                case 'title-desc':       return be.songName.localeCompare(ae.songName);
                case 'artist-asc':       return ae.artistName.localeCompare(be.artistName);
                case 'artist-desc':      return be.artistName.localeCompare(ae.artistName);
                case 'difficulty-asc':
                case 'difficulty-desc': {
                    const ad = ae.parts.find(p => p.type === typeFilter)?.difficulty ?? 0;
                    const bd = be.parts.find(p => p.type === typeFilter)?.difficulty ?? 0;
                    return this.state.sort === 'difficulty-asc' ? ad - bd : bd - ad;
                }
                case 'tuning-asc': {
                    const at = ae.parts.find(p => p.type === typeFilter)?.tuning ?? '';
                    const bt = be.parts.find(p => p.type === typeFilter)?.tuning ?? '';
                    return at.localeCompare(bt);
                }
            }
        });

        return result;
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    private onSongClick(sourced: SourcedEntry): void {
        this.app.navigate(new PreSceneScreen(this.app, this.texture, sourced.source, sourced.entry));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private setContent(html: string): void {
        this.container!.innerHTML = html;
    }

    private buildTuningSelect(typeFilter: string): string {
        const tunings = [...new Set(
            this.songs.flatMap(({ entry }) => entry.parts
                .filter(p => p.type === typeFilter && p.tuning)
                .map(p => p.tuning!))
        )].sort();
        return `<select class="lib-tuning" id="lib-tuning">
            <option value="All" ${this.state.tuningFilter === 'All' ? 'selected' : ''}>All tunings</option>
            ${tunings.map(t =>
                `<option value="${esc(t)}" ${this.state.tuningFilter === t ? 'selected' : ''}>${esc(t)}</option>`
            ).join('')}
        </select>`;
    }

    private buildSortOptions(isFiltered: boolean, isStringed: boolean): DropdownOption[] {
        const keys: SortOption[] = ['title-asc', 'title-desc', 'artist-asc', 'artist-desc'];
        if (isFiltered) keys.push('difficulty-asc', 'difficulty-desc');
        if (isStringed) keys.push('tuning-asc');
        return keys.map(value => ({ label: SORT_LABELS[value], value, selected: value === this.state.sort }));
    }
}

// ── Module helpers ────────────────────────────────────────────────────────────

function loadState(): LibraryState {
    try {
        return { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') };
    } catch { return { ...DEFAULT_STATE }; }
}

function saveState(s: LibraryState): void {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
}

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
