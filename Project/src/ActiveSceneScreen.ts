import * as THREE from "three";
import type { App, IScreen } from "./App";
import { FretPlayerScene3D } from "./FretPlayerScene3D";
import { SongPlayer } from "./SongPlayer";
import type { SongStructure, SongInstrumentNotes, SongInfo } from "./SongFormat";
import type { SongIndexEntry, SongIndexPart, ISongLibrary } from "./SongIndex";

export class ActiveSceneScreen implements IScreen {
    private scene: FretPlayerScene3D | null = null;
    private songPlayer: SongPlayer | null = null;
    private container: HTMLElement | null = null;
    private audioUrl: string | null = null;

    private app: App;
    private texture: THREE.Texture;
    private library: ISongLibrary;
    private entry: SongIndexEntry;
    private part: SongIndexPart;

    constructor(
        app: App,
        texture: THREE.Texture,
        library: ISongLibrary,
        entry: SongIndexEntry,
        part: SongIndexPart,
    ) {
        this.app = app;
        this.texture = texture;
        this.library = library;
        this.entry = entry;
        this.part = part;
    }

    async mount(container: HTMLElement): Promise<void> {
        this.container = container;

        const readJson = async <T>(filename: string): Promise<T> => {
            const file = await this.library.getSongFile(this.entry, filename);
            return JSON.parse(await file.text()) as T;
        };

        const [songStructure, songInfo, instrumentNotes] = await Promise.all([
            readJson<SongStructure>('arrangement.json'),
            readJson<SongInfo>('song.json'),
            readJson<SongInstrumentNotes>(`${this.part.name}.json`),
        ]);

        const instrumentPart =
            songInfo.InstrumentParts.find(p => p.InstrumentName === this.part.name) ??
            songInfo.InstrumentParts[0];

        this.scene = new FretPlayerScene3D(
            this.app.renderer, this.texture, songStructure, instrumentNotes, instrumentPart,
        );

        // Load audio via object URL, then revoke — AudioContext holds the decoded buffer.
        const audioFile = await this.library.getSongFile(this.entry, 'song.ogg');
        this.audioUrl = URL.createObjectURL(audioFile);
        this.songPlayer = new SongPlayer();
        await this.songPlayer.loadSong(this.audioUrl);
        URL.revokeObjectURL(this.audioUrl);
        this.audioUrl = null;

        this.app.activeScene = this.scene;
        this.songPlayer.play();

        this.app.onPreDraw = () => {
            if (this.scene && this.songPlayer)
                this.scene.currentSecond = this.songPlayer.currentSecond;
        };
        this.app.onSongPause = () => {
            if (!this.songPlayer?.isPlaying) return null;
            const pos = this.songPlayer.currentSecond;
            this.songPlayer.pause();
            return pos;
        };
        this.app.onSongResume = (seconds: number) => {
            if (this.scene) this.scene.currentSecond = seconds;
            this.songPlayer?.seekTo(seconds);
            this.songPlayer?.play();
        };

        // Minimal overlay: click to play/pause, back button to return to library.
        // Phase 6.6 will expand this with seek bar, time display, etc.
        container.innerHTML = `
            <div id="active-overlay">
                <button class="active-back-btn" id="active-back">&#8592; Library</button>
            </div>`;

        container.querySelector('#active-overlay')!.addEventListener('click', () => {
            if (this.songPlayer?.isPlaying) this.songPlayer.pause();
            else this.songPlayer?.play();
        });

        container.querySelector('#active-back')!.addEventListener('click', e => {
            e.stopPropagation();
            const library = this.library;
            import('./SongLibraryScreen').then(({ SongLibraryScreen }) => {
                this.app.navigate(new SongLibraryScreen(this.app, this.texture, library));
            });
        });
    }

    unmount(): void {
        this.songPlayer?.pause();
        this.scene?.destroy();
        if (this.audioUrl) { URL.revokeObjectURL(this.audioUrl); this.audioUrl = null; }
        this.app.activeScene  = null;
        this.app.onPreDraw    = null;
        this.app.onSongPause  = null;
        this.app.onSongResume = null;
        if (this.container) this.container.innerHTML = '';
        this.scene      = null;
        this.songPlayer = null;
        this.container  = null;
    }
}
