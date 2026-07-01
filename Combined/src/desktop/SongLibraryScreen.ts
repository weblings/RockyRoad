import * as THREE from "three";
import type { App, IScreen } from "./App";
import { loadAllSources, type SourcedEntry } from "../shared/SongSource";
import { loadSettings, saveSettings } from "../shared/Settings";
import { PreSceneScreen } from "./PreSceneScreen";

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
    private sortOpen = false;
    private connectOpen = false;

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
        const settings = loadSettings();
        const connected = !!settings.remoteServerUrl;

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
        const sel = (v: string) => v === this.state.sort ? ' selected' : '';

        this.setContent(`
            <div class="lib-screen">
                <div class="lib-bar">
                    <div class="lib-search-row">
                        <input class="lib-search" id="lib-search" type="text"
                            placeholder="Search songs, artists, albums…"
                            value="${esc(this.state.searchQuery)}" />
                        <div class="lib-sort-dropdown${this.sortOpen ? ' open' : ''}" id="lib-sort-dropdown">
                            <button class="lib-sort-trigger" id="lib-sort-trigger" type="button">
                                <span class="lib-sort-label">${SORT_LABELS[this.state.sort] ?? 'Title A–Z'}</span>
                                <span class="lib-sort-chevron">&#9662;</span>
                            </button>
                            <div class="lib-sort-menu">
                                <button class="lib-sort-option${sel('title-asc')}" data-sort="title-asc" type="button">Title A–Z</button>
                                <button class="lib-sort-option${sel('title-desc')}" data-sort="title-desc" type="button">Title Z–A</button>
                                <button class="lib-sort-option${sel('artist-asc')}" data-sort="artist-asc" type="button">Artist A–Z</button>
                                <button class="lib-sort-option${sel('artist-desc')}" data-sort="artist-desc" type="button">Artist Z–A</button>
                                ${isFiltered ? `
                                <button class="lib-sort-option${sel('difficulty-asc')}" data-sort="difficulty-asc" type="button">Difficulty ↑</button>
                                <button class="lib-sort-option${sel('difficulty-desc')}" data-sort="difficulty-desc" type="button">Difficulty ↓</button>` : ''}
                                ${isStringed ? `
                                <button class="lib-sort-option${sel('tuning-asc')}" data-sort="tuning-asc" type="button">Tuning A–Z</button>` : ''}
                            </div>
                        </div>
                        <button id="lib-connect-toggle" class="lib-btn-icon${connected ? ' lib-btn-icon--active' : ''}"
                                type="button" title="${connected ? 'Library connected — click to change' : 'Connect a library'}">
                            ${connected ? '● Library' : '+ Library'}
                        </button>
                        <button id="enter-vr" class="active-back-btn" style="display:none;margin-left:4px"
                                type="button" onclick="location.href='xr.html'">
                            <span>Enter VR</span>
                        </button>
                    </div>
                    ${this.connectOpen ? this.connectPanelHtml(settings.remoteServerUrl) : ''}
                    <div class="lib-filter-row">
                        <div id="lib-chips">
                            ${chips.map(f => `
                                <button class="lib-filter-btn ${f === this.state.instrumentFilter ? 'active' : 'inactive'}"
                                    data-filter="${f}" type="button">${f}</button>
                            `).join('')}
                        </div>
                        ${isStringed ? this.buildTuningSelect(typeFilter) : ''}
                    </div>
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

        this.container!.querySelector('#lib-sort-trigger')!.addEventListener('click', (e) => {
            e.stopPropagation();
            this.sortOpen = !this.sortOpen;
            (this.container!.querySelector('#lib-sort-dropdown') as HTMLElement)
                .classList.toggle('open', this.sortOpen);
        });

        this.container!.querySelector('.lib-sort-menu')!.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.lib-sort-option');
            if (!btn) return;
            this.state.sort = btn.dataset.sort as SortOption;
            this.sortOpen = false;
            saveState(this.state);
            (this.container!.querySelector('#lib-sort-dropdown') as HTMLElement).classList.remove('open');
            (this.container!.querySelector('.lib-sort-label') as HTMLElement).textContent = btn.textContent ?? '';
            this.container!.querySelectorAll('.lib-sort-option').forEach(el => el.classList.remove('selected'));
            btn.classList.add('selected');
            this.refreshCards();
        });

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

        this.container!.querySelector('#lib-connect-toggle')!.addEventListener('click', () => {
            this.connectOpen = !this.connectOpen;
            this.renderLibrary();
        });

        if (this.connectOpen) this.wireConnectPanel();

        this.container!.querySelector('#lib-grid')!.addEventListener('click', e => {
            const card = (e.target as HTMLElement).closest<HTMLElement>('[data-song-idx]');
            if (!card) return;
            this.onSongClick(this.songs[parseInt(card.dataset.songIdx!)]);
        });

        this.refreshCards();
    }

    // ── Connect panel ─────────────────────────────────────────────────────────

    private connectPanelHtml(currentUrl: string): string {
        return `
            <div class="lib-connect-panel">
                <p class="lib-connect-label">Library URL</p>
                <div class="lib-connect-row">
                    <input class="lib-connect-input" id="lib-connect-input" type="url"
                        placeholder="http://your-server/songs  (local dev: /remote-songs)"
                        value="${esc(currentUrl)}" />
                    <button class="lib-btn-primary" id="lib-connect-save" type="button">Save</button>
                    ${currentUrl ? `<button class="lib-btn-secondary" id="lib-connect-clear" type="button">Clear</button>` : ''}
                </div>
                <p class="lib-connect-hint">
                    Start the song server with <code>npm run serve-songs</code>, then enter
                    <code>http://localhost:8081/remote-songs</code> for local dev.
                </p>
            </div>`;
    }

    private wireConnectPanel(): void {
        const input = this.container!.querySelector<HTMLInputElement>('#lib-connect-input')!;

        this.container!.querySelector('#lib-connect-save')!.addEventListener('click', async () => {
            const url = input.value.trim();
            const s = loadSettings();
            s.remoteServerUrl = url;
            saveSettings(s);
            this.connectOpen = false;
            this.renderLoading();
            this.songs = await loadAllSources(url);
            this.renderLibrary();
        });

        this.container!.querySelector('#lib-connect-clear')?.addEventListener('click', async () => {
            const s = loadSettings();
            s.remoteServerUrl = '';
            saveSettings(s);
            this.connectOpen = false;
            this.renderLoading();
            this.songs = await loadAllSources('');
            this.renderLibrary();
        });
    }

    // ── Filtering + card rendering ────────────────────────────────────────────

    private refreshCards(): void {
        const grid = this.container?.querySelector<HTMLElement>('#lib-grid');
        if (!grid) return;

        const filtered = this.filteredSongs();

        grid.innerHTML = filtered.map(({ sourced, origIdx }) => {
            const artUrl = sourced.source.getAlbumArtUrl(sourced.entry);
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
                </button>`;
        }).join('');
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
