import * as THREE from "three";
import type { App, IScreen } from "./App";
import { FretPlayerScene3D } from "./FretPlayerScene3D";
import { SongPlayer } from "./SongPlayer";
import type { SongStructure, SongInstrumentNotes, SongInfo } from "./SongFormat";
import type { SongIndexEntry, SongIndexPart, ISongLibrary } from "./SongIndex";
import { loadSettings } from "./Settings";

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
    private mockKeyHandler: ((e: KeyboardEvent) => void) | null = null;

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

        const settings = loadSettings();

        this.scene = new FretPlayerScene3D(
            this.app.renderer, this.texture, songStructure, instrumentNotes, instrumentPart,
        );
        this.scene.boldText      = settings.boldText;
        this.scene.invertStrings = settings.invertStrings;

        // Load audio via object URL, then revoke — AudioContext holds the decoded buffer.
        const audioFile = await this.library.getSongFile(this.entry, 'song.ogg');
        this.audioUrl = URL.createObjectURL(audioFile);
        this.songPlayer = new SongPlayer();
        await this.songPlayer.loadSong(this.audioUrl);
        URL.revokeObjectURL(this.audioUrl);
        this.audioUrl = null;

        if (settings.skipIntro) {
            const skipTarget = instrumentNotes.Notes[0]?.TimeOffset ?? 0;
            if (skipTarget > 0) this.scene.currentSecond = skipTarget;
        }

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
        this.app.onSettingsChange = (s) => {
            if (this.scene) {
                this.scene.boldText      = s.boldText;
                this.scene.invertStrings = s.invertStrings;
            }
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

        // Press M to toggle mock detection (2 hits / 1 miss cycle).
        this.mockKeyHandler = (e: KeyboardEvent) => {
            if (e.key !== 'm' && e.key !== 'M') return;
            if (!this.scene) return;
            this.scene.mockDetection = !this.scene.mockDetection;
            this.scene.resetMockDetection();
        };
        window.addEventListener('keydown', this.mockKeyHandler);
    }

    unmount(): void {
        if (this.mockKeyHandler) { window.removeEventListener('keydown', this.mockKeyHandler); this.mockKeyHandler = null; }
        this.songPlayer?.pause();
        this.scene?.destroy();
        if (this.audioUrl) { URL.revokeObjectURL(this.audioUrl); this.audioUrl = null; }
        this.app.activeScene  = null;
        this.app.onPreDraw    = null;
        this.app.onSongPause      = null;
        this.app.onSongResume     = null;
        this.app.onSettingsChange = null;
        if (this.container) this.container.innerHTML = '';
        this.scene      = null;
        this.songPlayer = null;
        this.container  = null;
    }
}
