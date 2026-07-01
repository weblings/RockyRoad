import * as THREE from "three";
import type { App, IScreen } from "./App";
import type { SongIndexEntry, ISongLibrary } from "../shared/SongIndex";
import {
    HandleLibrary, FileListLibrary,
    saveLibraryHandle, loadLibraryHandle,
} from "../shared/SongIndex";
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

const HAS_PICKER = 'showDirectoryPicker' in window;

// ── SongLibraryScreen ─────────────────────────────────────────────────────────

export class SongLibraryScreen implements IScreen {
    private app: App;
    private texture: THREE.Texture;
    private container: HTMLElement | null = null;
    private library: ISongLibrary | null = null;
    private songs: SongIndexEntry[] = [];
    private state: LibraryState;
    private artUrls: Map<number, string> = new Map(); // songIndex → object URL
    private sortOpen = false;

    constructor(app: App, texture: THREE.Texture, existingLibrary?: ISongLibrary) {
        this.app = app;
        this.texture = texture;
        this.library = existingLibrary ?? null;
        this.state = loadState();
    }

    async mount(container: HTMLElement): Promise<void> {
        this.container = container;

        // If we were handed an already-loaded library (e.g. back button from active scene),
        // skip the welcome screen and go straight to the song list.
        if (this.library) {
            await this.useLibrary(this.library);
            return;
        }

        this.renderWelcome();

        // Only try to restore a saved handle on Chrome/Edge.
        if (!HAS_PICKER) return;

        const handle = await loadLibraryHandle();
        if (!handle) return;

        const perm = await handle.queryPermission({ mode: 'read' });
        if (perm === 'granted') {
            await this.useLibrary(new HandleLibrary(handle));
        } else {
            this.renderReallow(handle);
        }
    }

    unmount(): void {
        for (const url of this.artUrls.values()) URL.revokeObjectURL(url);
        this.artUrls.clear();
        if (this.container) this.container.innerHTML = '';
        this.container = null;
    }

    // ── Library loading ───────────────────────────────────────────────────────

    private async pickWithHandle(): Promise<void> {
        let handle: FileSystemDirectoryHandle;
        try {
            handle = await showDirectoryPicker({ mode: 'read' });
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') return;
            console.error('showDirectoryPicker failed:', err);
            return;
        }
        await saveLibraryHandle(handle);
        await this.useLibrary(new HandleLibrary(handle));
    }

    private pickWithInput(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.webkitdirectory = true;
        input.addEventListener('change', async () => {
            if (!input.files?.length) return;
            await this.useLibrary(new FileListLibrary(input.files));
        });
        input.click();
    }

    private async grantPermission(handle: FileSystemDirectoryHandle): Promise<void> {
        const perm = await handle.requestPermission({ mode: 'read' });
        if (perm === 'granted') await this.useLibrary(new HandleLibrary(handle));
    }

    private async useLibrary(library: ISongLibrary): Promise<void> {
        this.library = library;
        this.renderLoading();
        this.songs = await library.scan();
        this.renderLibrary();
        this.loadAlbumArts();
    }

    // ── Render states ─────────────────────────────────────────────────────────

    private renderWelcome(): void {
        const persistenceNote = HAS_PICKER ? '' : `
            <p class="lib-browser-note">
                Firefox doesn't support persistent folder access —
                you'll re-select your folder each visit.
                Use Chrome or Edge for a persistent library.
            </p>`;

        this.setContent(`
            <div class="lib-splash">
                <div class="lib-splash-inner">
                    <h1 class="lib-title text-primary">ChartPlayer</h1>
                    <p class="lib-subtitle text-secondary">Choose the folder where your songs are stored.</p>
                    <button class="lib-btn-primary" id="lib-pick">Choose folder</button>
                    ${persistenceNote}
                </div>
            </div>`);

        this.container!.querySelector('#lib-pick')!.addEventListener('click', () => {
            if (HAS_PICKER) this.pickWithHandle();
            else this.pickWithInput();
        });
    }

    private renderReallow(handle: FileSystemDirectoryHandle): void {
        this.setContent(`
            <div class="lib-splash">
                <div class="lib-splash-inner">
                    <h1 class="lib-title text-primary">ChartPlayer</h1>
                    <p class="lib-subtitle text-secondary">Re-allow access to your songs folder to continue.</p>
                    <button class="lib-btn-primary" id="lib-reallow">Re-allow access</button>
                    <button class="lib-btn-secondary" id="lib-pick-new">Choose a different folder</button>
                </div>
            </div>`);
        this.container!.querySelector('#lib-reallow')!
            .addEventListener('click', () => this.grantPermission(handle));
        this.container!.querySelector('#lib-pick-new')!
            .addEventListener('click', () => this.pickWithHandle());
    }

    private renderLoading(): void {
        this.setContent(`
            <div class="lib-splash">
                <div class="lib-splash-inner">
                    <p class="lib-subtitle">Scanning library…</p>
                </div>
            </div>`);
    }

    private renderLibrary(): void {
        const knownTypes = new Set(Object.values(INSTRUMENT_TYPE).filter(Boolean));
        const presentTypes = new Set<string>();
        for (const s of this.songs)
            for (const p of s.parts)
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
                        <button id="enter-vr" class="active-back-btn" style="display:none;margin-left:4px"
                                type="button" onclick="location.href='xr.html'">
                            <span>Enter VR</span>
                        </button>
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
            this.loadAlbumArts();
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

        grid.innerHTML = filtered.map(({ entry, origIdx }) => `
            <button class="lib-song-entry" data-song-idx="${origIdx}" type="button">
                <div class="lib-art-thumb" id="art-${origIdx}"></div>
                <div class="lib-song-meta">
                    <p class="lib-song-title">${esc(entry.songName)}</p>
                    <p class="lib-song-album">${esc(entry.albumName ?? '')}</p>
                    <p class="lib-song-artist">${esc(entry.artistName)}</p>
                </div>
            </button>`).join('');

        this.injectAlbumArts();
    }

    private filteredSongs(): { entry: SongIndexEntry; origIdx: number }[] {
        const q = this.state.searchQuery.toLowerCase();
        const typeFilter = INSTRUMENT_TYPE[this.state.instrumentFilter];

        const result = this.songs
            .map((entry, origIdx) => ({ entry, origIdx }))
            .filter(({ entry }) => {
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
            const ae = a.entry, be = b.entry;
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

    // ── Album art ─────────────────────────────────────────────────────────────

    private injectAlbumArts(): void {
        for (const [i, url] of this.artUrls) {
            const el = this.container?.querySelector(`#art-${i}`);
            if (el) el.innerHTML = `<img src="${url}" alt="" />`;
        }
    }

    private async loadAlbumArts(): Promise<void> {
        if (!this.library) return;
        for (const url of this.artUrls.values()) URL.revokeObjectURL(url);
        this.artUrls.clear();

        for (let i = 0; i < this.songs.length; i++) {
            const url = await this.library.getAlbumArtUrl(this.songs[i]);
            if (!url) continue;
            this.artUrls.set(i, url);
            const el = this.container?.querySelector(`#art-${i}`);
            if (el) el.innerHTML = `<img src="${url}" alt="" />`;
        }
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    private onSongClick(entry: SongIndexEntry): void {
        if (!this.library) return;
        this.app.navigate(new PreSceneScreen(this.app, this.texture, this.library, entry));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private setContent(html: string): void {
        this.container!.innerHTML = html;
    }

    private buildTuningSelect(typeFilter: string): string {
        const tunings = [...new Set(
            this.songs.flatMap(s => s.parts
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
