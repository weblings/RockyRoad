import * as THREE from "three";
import type { App, IScreen } from "./App";
import type { SongIndexEntry, SongIndexPart, ISongLibrary } from "./SongIndex";
import { ActiveSceneScreen } from "./ActiveSceneScreen";

const PART_LABEL: Record<string, string> = {
    LeadGuitar: 'Lead', RhythmGuitar: 'Rhythm', BassGuitar: 'Bass',
    Keys: 'Keys', Drums: 'Drums',
};

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class PreSceneScreen implements IScreen {
    private app: App;
    private texture: THREE.Texture;
    private library: ISongLibrary;
    private entry: SongIndexEntry;
    private selectedPart: SongIndexPart;
    private container: HTMLElement | null = null;
    private artUrl: string | null = null;

    constructor(app: App, texture: THREE.Texture, library: ISongLibrary, entry: SongIndexEntry) {
        this.app = app;
        this.texture = texture;
        this.library = library;
        this.entry = entry;
        this.selectedPart = entry.parts.find(p => p.type !== 'Vocals') ?? entry.parts[0];
    }

    async mount(container: HTMLElement): Promise<void> {
        this.container = container;
        const playableParts = this.entry.parts.filter(p => p.type !== 'Vocals');

        container.innerHTML = `
            <div class="pre-screen">
                <button class="pre-back" id="pre-back" type="button">
                    <svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.0908 14.3334C12.972 14.3334 12.9125 14.1898 12.9965 14.1058L17.7021 9.40022C17.9625 9.13987 17.9625 8.71776 17.7021 8.45741L16.2879 7.04319C16.0275 6.78284 15.6054 6.78284 15.3451 7.04319L6.8598 15.5285C6.59945 15.7888 6.59945 16.2109 6.8598 16.4713L8.27401 17.8855L8.27536 17.8868L15.3453 24.9568C15.6057 25.2172 16.0278 25.2172 16.2881 24.9568L17.7024 23.5426C17.9627 23.2822 17.9627 22.8601 17.7024 22.5998L12.9969 17.8944C12.9129 17.8104 12.9724 17.6668 13.0912 17.6668L26 17.6668C26.3682 17.6668 26.6667 17.3683 26.6667 17.0001V15.0001C26.6667 14.6319 26.3682 14.3334 26 14.3334L13.0908 14.3334Z" fill="currentColor"/></svg>
                    <span>Library</span>
                </button>
                <div class="pre-content">
                    <div class="pre-art" id="pre-art">
                        <div class="pre-art-placeholder"></div>
                    </div>
                    <div class="pre-song-name">${esc(this.entry.songName)}</div>
                    <div class="pre-artist-name">${esc(this.entry.artistName)}</div>

                    ${playableParts.length > 1 ? `
                    <div class="pre-section-label">Instrument</div>
                    <div class="pre-parts" id="pre-parts">
                        ${playableParts.map(p => `
                            <button class="pre-part-btn${p.name === this.selectedPart.name ? ' active' : ''}"
                                data-part-name="${esc(p.name)}">
                                <span class="pre-part-type">${esc(PART_LABEL[p.type] ?? p.type)}</span>
                                ${p.tuning ? `<span class="pre-part-tuning">${esc(p.tuning)}</span>` : ''}
                            </button>`).join('')}
                    </div>` : ''}

                    <div class="pre-action-row">
                        <button class="pre-tune-btn${this.selectedPart.tuningOffsets ? '' : ' hidden'}"
                            id="pre-tune">Tune</button>
                        <button class="pre-play-btn" id="pre-play">&#9654; Play</button>
                    </div>
                </div>
            </div>`;

        // Back to library
        container.querySelector('#pre-back')!.addEventListener('click', () => {
            const library = this.library;
            import('./SongLibraryScreen').then(({ SongLibraryScreen }) => {
                this.app.navigate(new SongLibraryScreen(this.app, this.texture, library));
            });
        });

        // Instrument selector
        container.querySelector('#pre-parts')?.addEventListener('click', e => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-part-name]');
            if (!btn) return;
            const part = this.entry.parts.find(p => p.name === btn.dataset.partName);
            if (!part) return;
            this.selectedPart = part;
            container.querySelectorAll('.pre-part-btn').forEach(b =>
                b.classList.toggle('active', (b as HTMLElement).dataset.partName === part.name));
            container.querySelector('#pre-tune')?.classList.toggle('hidden', !part.tuningOffsets);
        });

        // Tune button — explicit tune request, always goes through tuner
        container.querySelector('#pre-tune')!.addEventListener('click', () => {
            import('./TunerScreen').then(({ TunerScreen }) => {
                this.app.navigate(new TunerScreen(
                    this.app, this.texture, this.library, this.entry, this.selectedPart, 'song-flow',
                ));
            });
        });

        // Play — auto-tunes if needed, otherwise goes straight to active scene
        container.querySelector('#pre-play')!.addEventListener('click', () => {
            if (this.app.shouldAutoTune(this.selectedPart)) {
                import('./TunerScreen').then(({ TunerScreen }) => {
                    this.app.navigate(new TunerScreen(
                        this.app, this.texture, this.library, this.entry, this.selectedPart, 'song-flow',
                    ));
                });
            } else {
                this.app.navigate(
                    new ActiveSceneScreen(this.app, this.texture, this.library, this.entry, this.selectedPart),
                );
            }
        });

        // Album art — async, may resolve after mount returns
        const url = await this.library.getAlbumArtUrl(this.entry);
        if (url && this.container) {
            this.artUrl = url;
            const artEl = this.container.querySelector('#pre-art');
            if (artEl) artEl.innerHTML = `<img src="${url}" alt="" />`;
        }
    }

    unmount(): void {
        if (this.artUrl) { URL.revokeObjectURL(this.artUrl); this.artUrl = null; }
        if (this.container) this.container.innerHTML = '';
        this.container = null;
    }
}
