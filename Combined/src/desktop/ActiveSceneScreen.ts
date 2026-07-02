import * as THREE from "three";
import type { App, IScreen } from "./App";
import { FretPlayerScene3D } from "../shared/FretPlayerScene3D";
import { KeysPlayerScene3D } from "../shared/KeysPlayerScene3D";
import { fromHex } from "../shared/UIColor";
import { SongPlayer, SilentPlayer, type ISongPlayer } from "../shared/SongPlayer";
import type { SongStructure, SongInstrumentNotes, SongKeyboardNotes, SongInfo, SongSection } from "../shared/SongFormat";
import type { SongIndexEntry, SongIndexPart } from "../shared/SongIndex";
import type { ISongSource } from "../shared/SongSource";
import { loadSettings } from "../shared/Settings";
import { NoteDetector } from "../shared/NoteDetector";
import type { PitchDetector } from "../shared/PitchDetector";

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export class ActiveSceneScreen implements IScreen {
    private scene: FretPlayerScene3D | null = null;
    private keysScene: KeysPlayerScene3D | null = null;
    // Actual note range of the loaded chart — used when fullKeyboard is toggled off.
    private keysNoteMin = 21;
    private keysNoteMax = 108;
    private songPlayer: ISongPlayer | null = null;
    private container: HTMLElement | null = null;
    private totalDuration = 0;
    private sections: SongSection[] = [];

    // Scroll-back animation state — set by onSongRollback, consumed by onPreDraw.
    private rollbackFromTime: number | null = null;
    private rollbackToTime: number | null = null;
    private rollbackStartMs = 0;
    private static readonly ROLLBACK_ANIM_SECS = 0.8;

    private app: App;
    private texture: THREE.Texture;
    private source: ISongSource;
    private entry: SongIndexEntry;
    private part: SongIndexPart;
    private mockKeyHandler: ((e: KeyboardEvent) => void) | null = null;

    // Pitch detection — optional; null if mic was denied or not a stringed instrument.
    // May be passed in from TunerScreen (reusing the already-open mic stream) or
    // created lazily here if the user skipped the tuner.
    private pitchDetector: PitchDetector | null;
    private noteDetector: NoteDetector | null = null;
    private ownsPitchDetector = false; // true = we created it, we must destroy it

    constructor(
        app: App,
        texture: THREE.Texture,
        source: ISongSource,
        entry: SongIndexEntry,
        part: SongIndexPart,
        pitchDetector: PitchDetector | null = null,
    ) {
        this.app = app;
        this.texture = texture;
        this.source = source;
        this.entry = entry;
        this.part = part;
        this.pitchDetector = pitchDetector;
    }

    async mount(container: HTMLElement): Promise<void> {
        this.container = container;

        const readJson = async <T>(filename: string): Promise<T> => {
            const resp = await fetch(this.source.getFileUrl(this.entry, filename));
            if (!resp.ok) throw new Error(`Failed to load ${filename}: HTTP ${resp.status}`);
            return resp.json() as Promise<T>;
        };

        const [songStructure, songInfo] = await Promise.all([
            readJson<SongStructure>('arrangement.json'),
            readJson<SongInfo>('song.json'),
        ]);

        const settings = loadSettings();

        if (this.part.type === 'Keys') {
            const keyboardNotes = await readJson<SongKeyboardNotes>(`${this.part.name}.json`);
            this.sections = keyboardNotes.Sections ?? [];
            // Store actual note range so fullKeyboard can be toggled live.
            const midiNotes = keyboardNotes.Notes.map(n => n.Note);
            this.keysNoteMin = Math.max(21,  Math.min(...midiNotes) - 1);
            this.keysNoteMax = Math.min(108, Math.max(...midiNotes) + 1);
            this.keysScene = new KeysPlayerScene3D(
                this.app.renderer, this.texture, songStructure, keyboardNotes,
            );
            this.keysScene.minKey = settings.fullKeyboard ? 21  : this.keysNoteMin;
            this.keysScene.maxKey = settings.fullKeyboard ? 108 : this.keysNoteMax;
            this.keysScene.syncHighwayBounds();
            this.keysScene.topDown        = settings.keysTopDown;
            this.keysScene.rightHandColor = fromHex(settings.keysRightHandColor);
            this.keysScene.leftHandColor  = fromHex(settings.keysLeftHandColor);
            if (settings.skipIntro) {
                const skipTarget = keyboardNotes.Notes[0]?.TimeOffset ?? 0;
                if (skipTarget > 0) this.keysScene.currentSecond = skipTarget;
            }
        } else {
            const instrumentNotes = await readJson<SongInstrumentNotes>(`${this.part.name}.json`);
            const instrumentPart =
                songInfo.InstrumentParts.find(p => p.InstrumentName === this.part.name) ??
                songInfo.InstrumentParts[0];
            this.scene = new FretPlayerScene3D(
                this.app.renderer, this.texture, songStructure, instrumentNotes, instrumentPart,
            );
            this.scene.boldText      = settings.boldText;
            this.scene.invertStrings = settings.invertStrings;
            this.scene.leftyMode     = settings.leftyMode;
            this.sections = instrumentNotes.Sections?.length > 0
                ? instrumentNotes.Sections
                : (songStructure.Sections ?? []);
            if (settings.skipIntro) {
                const skipTarget = instrumentNotes.Notes[0]?.TimeOffset ?? 0;
                if (skipTarget > 0) this.scene.currentSecond = skipTarget;
            }
        }

        let player: ISongPlayer;
        try {
            const audioUrl = this.source.getFileUrl(this.entry, 'song.ogg');
            const songPlayer = new SongPlayer();
            await songPlayer.loadSong(audioUrl);
            player = songPlayer;
        } catch {
            player = new SilentPlayer(songInfo.SongLengthSeconds ?? 0);
        }
        this.songPlayer = player;

        this.totalDuration = player.duration;

        this.app.activeScene = this.scene ?? this.keysScene;
        this.app.activeInstrumentType = this.part.type;
        this.songPlayer.play();

        // Note detection — stringed instruments only.
        if (this.part.tuningOffsets && this.scene) {
            const { notes, notesDetected } = this.scene.detectionState();
            this.noteDetector = new NoteDetector(
                notes, this.part,
                () => this.songPlayer?.currentSecond ?? 0,
                notesDetected,
                () => this.scene?.gracePeriodEndTime ?? null,
            );
            // If no detector was passed from the tuner, open the mic now.
            if (!this.pitchDetector) {
                this.ownsPitchDetector = true;
                import('../shared/PitchDetector').then(({ PitchDetector }) => {
                    PitchDetector.create().then(det => {
                        this.pitchDetector = det;
                    }).catch(() => { /* mic denied — stay in unscored mode */ });
                });
            }
        }

        this.app.onSongPause = () => {
            if (!this.songPlayer?.isPlaying) return null;
            const pos = this.songPlayer.currentSecond;
            this.songPlayer.pause();
            return pos;
        };
        // onSongRollback: fires immediately when a resume-with-countdown begins.
        // Starts the scroll-back animation and marks the grace period.
        this.app.onSongRollback = (seconds: number) => {
            if ((!this.scene && !this.keysScene) || !this.songPlayer) return;
            this.rollbackFromTime = this.songPlayer.currentSecond;
            this.rollbackToTime   = seconds;
            this.rollbackStartMs  = performance.now();
            if (this.scene) this.scene.gracePeriodEndTime = this.rollbackFromTime;
            this.songPlayer.seekTo(seconds);
            this.noteDetector?.reset();
        };
        // onSongResume: fires after the countdown completes — audio only.
        // Scene position was already set by onSongRollback / animation.
        this.app.onSongResume = (seconds: number) => {
            this.songPlayer?.seekTo(seconds);
            this.songPlayer?.play();
        };
        this.app.onSettingsChange = (s) => {
            if (this.scene) {
                this.scene.boldText      = s.boldText;
                this.scene.invertStrings = s.invertStrings;
                this.scene.leftyMode     = s.leftyMode;
            }
            if (this.keysScene) {
                this.keysScene.minKey = s.fullKeyboard ? 21  : this.keysNoteMin;
                this.keysScene.maxKey = s.fullKeyboard ? 108 : this.keysNoteMax;
                this.keysScene.syncHighwayBounds();
                this.keysScene.topDown        = s.keysTopDown;
                this.keysScene.rightHandColor = fromHex(s.keysRightHandColor);
                this.keysScene.leftHandColor  = fromHex(s.keysLeftHandColor);
            }
        };

        this.buildOverlay(container);

        // Press M to toggle mock detection (2 hits / 1 miss cycle).
        this.mockKeyHandler = (e: KeyboardEvent) => {
            if (e.key !== 'm' && e.key !== 'M') return;
            if (!this.scene) return;
            this.scene.mockDetection = !this.scene.mockDetection;
            this.scene.resetMockDetection();
        };
        window.addEventListener('keydown', this.mockKeyHandler);
    }

    private buildOverlay(container: HTMLElement): void {
        const dur = this.totalDuration;
        const durStr = formatTime(dur);
        const PLAY_SVG  = `<svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.6667 6.6548C10.6667 6.10764 11.2894 5.79346 11.7295 6.11862L24.377 15.4634C24.7377 15.7298 24.7377 16.2692 24.3771 16.5357L11.7295 25.8813C11.2895 26.2065 10.6667 25.8923 10.6667 25.3451L10.6667 6.6548Z" fill="currentColor"/></svg>`;
        const PAUSE_SVG = `<svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="7" y="6" width="6" height="20" rx="1" fill="currentColor"/><rect x="19" y="6" width="6" height="20" rx="1" fill="currentColor"/></svg>`;

        container.innerHTML = `
            <div id="active-overlay">
                <div class="active-bar">
                    <button class="active-back-btn" id="active-back" type="button">
                        <svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.0908 14.3334C12.972 14.3334 12.9125 14.1898 12.9965 14.1058L17.7021 9.40022C17.9625 9.13987 17.9625 8.71776 17.7021 8.45741L16.2879 7.04319C16.0275 6.78284 15.6054 6.78284 15.3451 7.04319L6.8598 15.5285C6.59945 15.7888 6.59945 16.2109 6.8598 16.4713L8.27401 17.8855L8.27536 17.8868L15.3453 24.9568C15.6057 25.2172 16.0278 25.2172 16.2881 24.9568L17.7024 23.5426C17.9627 23.2822 17.9627 22.8601 17.7024 22.5998L12.9969 17.8944C12.9129 17.8104 12.9724 17.6668 13.0912 17.6668L26 17.6668C26.3682 17.6668 26.6667 17.3683 26.6667 17.0001V15.0001C26.6667 14.6319 26.3682 14.3334 26 14.3334L13.0908 14.3334Z" fill="currentColor"/></svg>
                        <span>Library</span>
                    </button>
                    <button class="active-play-btn" id="active-play" type="button">${PLAY_SVG}</button>
                    <span class="active-time" id="active-time">0:00</span>
                    <div class="active-seek-wrap">
                        <div class="seek-track" id="active-seek">
                            <div class="seek-fill" id="active-seek-fill"></div>
                            <div id="active-sections"></div>
                            <div class="seek-thumb" id="active-seek-thumb"></div>
                        </div>
                    </div>
                    <span class="active-duration">${durStr}</span>
                    <div class="speed-group">
                        <button class="speed-step" id="speed-down" type="button">&#x2212;</button>
                        <select id="active-speed-select"></select>
                        <button class="speed-step" id="speed-up" type="button">+</button>
                    </div>
                    <button class="active-back-btn" id="active-settings" type="button">
                        <svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.3321 4C12.598 4 11.9728 4.50932 11.8154 5.22745L11.4396 6.96752C10.8867 7.19965 10.3672 7.49361 9.88904 7.84127L8.19799 7.29239C7.50395 7.06339 6.74634 7.35056 6.37926 7.98082L4.71259 10.8636C4.34551 11.4939 4.48613 12.2948 5.04981 12.7627L6.42361 13.9071C6.38394 14.2002 6.36329 14.4981 6.36329 14.8C6.36329 15.1019 6.38394 15.3998 6.42361 15.6929L5.04981 16.8373C4.48613 17.3052 4.34551 18.1061 4.71259 18.7364L6.37926 21.6192C6.74634 22.2494 7.50395 22.5366 8.19799 22.3076L9.88904 21.7587C10.3672 22.1064 10.8867 22.4003 11.4396 22.6325L11.8154 24.3725C11.9728 25.0907 12.598 25.6 13.3321 25.6H16.6654C17.3994 25.6 18.0247 25.0907 18.182 24.3725L18.5579 22.6325C19.1107 22.4003 19.6303 22.1064 20.1084 21.7587L21.7995 22.3076C22.4935 22.5366 23.2511 22.2494 23.6182 21.6192L25.2849 18.7364C25.6519 18.1061 25.5113 17.3052 24.9476 16.8373L23.5738 15.6929C23.6135 15.3998 23.6342 15.1019 23.6342 14.8C23.6342 14.4981 23.6135 14.2002 23.5738 13.9071L24.9476 12.7627C25.5113 12.2948 25.6519 11.4939 25.2849 10.8636L23.6182 7.98082C23.2511 7.35056 22.4935 7.06339 21.7995 7.29239L20.1084 7.84127C19.6303 7.49361 19.1107 7.19965 18.5579 6.96752L18.182 5.22745C18.0247 4.50932 17.3994 4 16.6654 4H13.3321ZM14.9987 18.4C16.9869 18.4 18.5987 16.7882 18.5987 14.8C18.5987 12.8118 16.9869 11.2 14.9987 11.2C13.0105 11.2 11.3987 12.8118 11.3987 14.8C11.3987 16.7882 13.0105 18.4 14.9987 18.4Z" fill="currentColor"/></svg>
                        <span>Settings</span>
                    </button>
                </div>
            </div>`;

        const overlay    = container.querySelector('#active-overlay') as HTMLElement;
        const seekTrack  = container.querySelector('#active-seek') as HTMLElement;
        const fillEl     = container.querySelector('#active-seek-fill') as HTMLElement;
        const thumbEl    = container.querySelector('#active-seek-thumb') as HTMLElement;
        const timeEl     = container.querySelector('#active-time') as HTMLElement;
        const playBtn    = container.querySelector('#active-play') as HTMLButtonElement;
        const sectionsDiv = container.querySelector('#active-sections') as HTMLElement;

        // Section tick marks
        if (dur > 0) {
            for (const section of this.sections) {
                const t = section.StartTime;
                if (t == null || t <= 0) continue;
                const pct = Math.min(t / dur * 100, 100);
                const tick = document.createElement('div');
                tick.className = 'seek-section-tick';
                tick.style.left = `${pct}%`;
                tick.title = section.Name;
                sectionsDiv.appendChild(tick);
            }
        }

        // Auto-hide bar after 3s of inactivity (only while playing)
        let hideTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleHide = () => {
            if (hideTimer) clearTimeout(hideTimer);
            if (this.songPlayer?.isPlaying) {
                hideTimer = setTimeout(() => overlay.classList.add('bar-hidden'), 3000);
            }
        };
        const showBar = () => {
            overlay.classList.remove('bar-hidden');
            scheduleHide();
        };
        overlay.addEventListener('mousemove', showBar);
        showBar(); // visible on mount

        // Scrubbing state
        let isScrubbing = false;
        let wasPlayingBeforeScrub = false;
        let prevIsPlaying = true;

        const getPct = (e: PointerEvent): number => {
            const rect = seekTrack.getBoundingClientRect();
            return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        };
        const setScrubPos = (pct: number): number => {
            const t = pct * dur;
            fillEl.style.width  = `${pct * 100}%`;
            thumbEl.style.left  = `calc(${pct * 100}% - 10px)`;
            timeEl.textContent  = formatTime(t);
            const activeScene = this.scene ?? this.keysScene;
            if (activeScene) activeScene.currentSecond = t;
            return t;
        };

        seekTrack.addEventListener('pointerdown', (e) => {
            isScrubbing = true;
            wasPlayingBeforeScrub = this.songPlayer?.isPlaying ?? false;
            if (wasPlayingBeforeScrub) this.songPlayer?.pause();
            seekTrack.setPointerCapture(e.pointerId);
            setScrubPos(getPct(e));
        });
        seekTrack.addEventListener('pointermove', (e) => {
            if (!isScrubbing) return;
            setScrubPos(getPct(e));
        });
        seekTrack.addEventListener('pointerup', (e) => {
            if (!isScrubbing) return;
            const t = setScrubPos(getPct(e));
            this.songPlayer?.seekTo(t);
            if (wasPlayingBeforeScrub) {
                this.app.resumeWithCountdown(t);
                scheduleHide();
            } else {
                showBar();
            }
            isScrubbing = false;
        });

        // Play/pause button — resume uses the same 3-2-1 countdown as settings close.
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.songPlayer?.isPlaying) {
                this.songPlayer.pause();
                showBar(); // always visible while paused
            } else {
                const pausedAt = this.songPlayer?.currentSecond ?? 0;
                this.app.resumeWithCountdown(pausedAt);
                scheduleHide();
            }
        });

        // Speed compound control: [−] select [+]
        const speedSelect = container.querySelector('#active-speed-select') as HTMLSelectElement;
        const SPEED_MIN  = 0.05, SPEED_MAX = 2.0, SPEED_STEP = 0.05;
        const SPEED_PRESET_STEP = 0.2;
        const speedLabel = (v: number) => (Math.round(v * 100) / 100).toString().replace(/\.?0+$/, '') + '×';
        for (let r = SPEED_PRESET_STEP; r <= SPEED_MAX + 0.001; r += SPEED_PRESET_STEP) {
            const v = Math.round(r / SPEED_PRESET_STEP) * SPEED_PRESET_STEP;
            const opt = document.createElement('option');
            opt.value = v.toFixed(2);
            opt.textContent = speedLabel(v);
            opt.selected = Math.abs(v - 1) < 0.001;
            speedSelect.appendChild(opt);
        }
        let customOpt: HTMLOptionElement | null = null;
        const setSpeed = (rate: number) => {
            if (!this.songPlayer) return;
            const rounded = Math.round(rate / SPEED_STEP) * SPEED_STEP;
            const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, rounded));
            this.songPlayer.playbackRate = clamped;
            const isPreset = Math.abs(Math.round(clamped / SPEED_PRESET_STEP) * SPEED_PRESET_STEP - clamped) < 0.001;
            if (isPreset) {
                if (customOpt) { speedSelect.removeChild(customOpt); customOpt = null; }
                speedSelect.value = clamped.toFixed(2);
            } else {
                if (!customOpt) {
                    customOpt = document.createElement('option');
                    speedSelect.insertBefore(customOpt, speedSelect.firstChild);
                }
                customOpt.value = clamped.toFixed(2);
                customOpt.textContent = speedLabel(clamped);
                customOpt.selected = true;
            }
            showBar();
        };
        speedSelect.addEventListener('change', (e) => {
            e.stopPropagation();
            setSpeed(Number(speedSelect.value));
        });
        container.querySelector('#speed-down')!.addEventListener('click', (e) => {
            e.stopPropagation();
            setSpeed((this.songPlayer?.playbackRate ?? 1) - SPEED_STEP);
        });
        container.querySelector('#speed-up')!.addEventListener('click', (e) => {
            e.stopPropagation();
            setSpeed((this.songPlayer?.playbackRate ?? 1) + SPEED_STEP);
        });

        // Back button
        container.querySelector('#active-back')!.addEventListener('click', e => {
            e.stopPropagation();
            import('./SongLibraryScreen').then(({ SongLibraryScreen }) => {
                this.app.navigate(new SongLibraryScreen(this.app, this.texture));
            });
        });

        // Settings button
        container.querySelector('#active-settings')!.addEventListener('click', e => {
            e.stopPropagation();
            this.app.openSettings();
        });

        // onPreDraw: keep seek bar and play button in sync with audio clock.
        this.app.onPreDraw = () => {
            const activeScene = this.scene ?? this.keysScene;
            if (!activeScene || !this.songPlayer) return;

            // Drive note detection every frame
            if (this.noteDetector) {
                const result = this.pitchDetector?.detect() ?? null;
                this.noteDetector.tick(result);
            }

            let displayTime: number;
            if (this.rollbackFromTime !== null && this.rollbackToTime !== null) {
                const elapsed  = (performance.now() - this.rollbackStartMs) / 1000;
                const progress = Math.min(elapsed / ActiveSceneScreen.ROLLBACK_ANIM_SECS, 1);
                // Ease-out cubic: decelerates as it reaches the target
                const eased    = 1 - Math.pow(1 - progress, 3);
                displayTime = this.rollbackFromTime + (this.rollbackToTime - this.rollbackFromTime) * eased;
                activeScene.currentSecond = displayTime;
                if (progress >= 1) { this.rollbackFromTime = null; this.rollbackToTime = null; }
            } else {
                displayTime = this.songPlayer.currentSecond;
                activeScene.currentSecond = displayTime;
            }

            if (!isScrubbing && dur > 0) {
                const pct = displayTime / dur * 100;
                fillEl.style.width  = `${pct}%`;
                thumbEl.style.left  = `calc(${pct}% - 10px)`;
                timeEl.textContent  = formatTime(displayTime);
            }

            const playing = this.songPlayer.isPlaying;
            playBtn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;

            // Song just ended naturally — show bar so user can navigate away
            if (prevIsPlaying && !playing) showBar();
            prevIsPlaying = playing;
        };
    }

    unmount(): void {
        if (this.mockKeyHandler) { window.removeEventListener('keydown', this.mockKeyHandler); this.mockKeyHandler = null; }
        this.songPlayer?.pause();
        this.scene?.destroy();
        this.keysScene?.destroy();
        if (this.ownsPitchDetector) this.pitchDetector?.destroy();
        this.pitchDetector = null;
        this.noteDetector  = null;
        this.rollbackFromTime = null;
        this.rollbackToTime   = null;
        this.app.activeScene          = null;
        this.app.activeInstrumentType = null;
        this.app.onPreDraw            = null;
        this.app.onSongPause       = null;
        this.app.onSongRollback    = null;
        this.app.onSongResume      = null;
        this.app.onSettingsChange  = null;
        if (this.container) this.container.innerHTML = '';
        this.scene      = null;
        this.keysScene  = null;
        this.songPlayer = null;
        this.container  = null;
    }
}
