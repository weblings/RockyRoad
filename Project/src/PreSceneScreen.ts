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
                <button class="pre-back" id="pre-back">&#8592; Library</button>
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
