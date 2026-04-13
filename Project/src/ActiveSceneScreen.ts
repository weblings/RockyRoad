import * as THREE from "three";
import type { App, IScreen } from "./App";
import { FretPlayerScene3D } from "./FretPlayerScene3D";
import { KeysPlayerScene3D } from "./KeysPlayerScene3D";
import { ChartScene3D } from "./ChartScene3D";
import { Camera3D } from "./Camera3D";
import { fromHex } from "./UIColor";
import { SongPlayer, SilentPlayer, type ISongPlayer } from "./SongPlayer";
import type { SongStructure, SongInstrumentNotes, SongKeyboardNotes, SongInfo, SongSection } from "./SongFormat";
import type { SongIndexEntry, SongIndexPart, ISongLibrary } from "./SongIndex";
import { loadSettings } from "./Settings";
import { NoteDetector } from "./NoteDetector";
import type { PitchDetector } from "./PitchDetector";

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export class ActiveSceneScreen implements IScreen {
    private scene: ChartScene3D | null = null;
    // Note range of the loaded keys chart — used when fullKeyboard is toggled off.
    private keysNoteMin = 21;
    private keysNoteMax = 108;
    private songPlayer: ISongPlayer | null = null;
    private container: HTMLElement | null = null;
    private audioUrl: string | null = null;
    private totalDuration = 0;
    private sections: SongSection[] = [];

    // Scroll-back animation state — set by onSongRollback, consumed by onPreDraw.
    private rollbackFromTime: number | null = null;
    private rollbackToTime: number | null = null;
    private rollbackStartMs = 0;
    private static readonly ROLLBACK_ANIM_SECS = 0.8;

    private app: App;
    private texture: THREE.Texture;
    private library: ISongLibrary;
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
        library: ISongLibrary,
        entry: SongIndexEntry,
        part: SongIndexPart,
        pitchDetector: PitchDetector | null = null,
    ) {
        this.app = app;
        this.texture = texture;
        this.library = library;
        this.entry = entry;
        this.part = part;
        this.pitchDetector = pitchDetector;
    }

    async mount(container: HTMLElement): Promise<void> {
        this.container = container;

        const readJson = async <T>(filename: string): Promise<T> => {
            const file = await this.library.getSongFile(this.entry, filename);
            return JSON.parse(await file.text()) as T;
        };

        const [songStructure, songInfo] = await Promise.all([
            readJson<SongStructure>('arrangement.json'),
            readJson<SongInfo>('song.json'),
        ]);

        const instrumentPart =
            songInfo.InstrumentParts.find(p => p.InstrumentName === this.part.name) ??
            songInfo.InstrumentParts[0];

        const settings = loadSettings();

        this.app.activeInstrumentType = this.part.type;

        let notes0TimeOffset = 0;

        if (this.part.type === 'Keys') {
            const keyboardNotes = await readJson<SongKeyboardNotes>(`${this.part.name}.json`);
            this.sections = keyboardNotes.Sections ?? [];
            notes0TimeOffset = keyboardNotes.Notes[0]?.TimeOffset ?? 0;
            // Store the actual note range so fullKeyboard can be toggled live.
            const midiNotes = keyboardNotes.Notes.map(n => n.Note);
            this.keysNoteMin = Math.max(21, Math.min(...midiNotes) - 1);
            this.keysNoteMax = Math.min(108, Math.max(...midiNotes) + 1);
            const size = this.app.renderer.getSize(new THREE.Vector2());
            const keysScene = new KeysPlayerScene3D(
                this.app.renderer,
                new Camera3D(size.x, size.y),
                this.texture,
                songStructure,
                keyboardNotes,
            );
            if (settings.fullKeyboard) {
                keysScene.minKey = 21;   // A0 — standard 88-key lower bound
                keysScene.maxKey = 108;  // C8 — standard 88-key upper bound
            } else {
                keysScene.minKey = this.keysNoteMin;
                keysScene.maxKey = this.keysNoteMax;
            }
            keysScene.syncHighwayBounds();
            keysScene.topDown        = settings.keysTopDown;
            keysScene.rightHandColor = fromHex(settings.keysRightHandColor);
            keysScene.leftHandColor  = fromHex(settings.keysLeftHandColor);
            this.scene = keysScene;
        } else {
            const instrumentNotes = await readJson<SongInstrumentNotes>(`${this.part.name}.json`);
            this.sections = instrumentNotes.Sections?.length > 0
                ? instrumentNotes.Sections
                : (songStructure.Sections ?? []);
            notes0TimeOffset = instrumentNotes.Notes[0]?.TimeOffset ?? 0;
            const fretScene = new FretPlayerScene3D(
                this.app.renderer, this.texture, songStructure, instrumentNotes, instrumentPart,
            );
            fretScene.boldText      = settings.boldText;
            fretScene.invertStrings = settings.invertStrings;
            fretScene.leftyMode     = settings.leftyMode;
            this.scene = fretScene;

            // Note detection — stringed instruments only.
            if (this.part.tuningOffsets) {
                const { notes, notesDetected } = fretScene.detectionState();
                this.noteDetector = new NoteDetector(
                    notes, this.part,
                    () => this.songPlayer?.currentSecond ?? 0,
                    notesDetected,
                    () => fretScene.gracePeriodEndTime ?? null,
                );
                // If no detector was passed from the tuner, open the mic now.
                if (!this.pitchDetector) {
                    this.ownsPitchDetector = true;
                    import('./PitchDetector').then(({ PitchDetector }) => {
                        PitchDetector.create().then(det => {
                            this.pitchDetector = det;
                        }).catch(() => { /* mic denied — stay in unscored mode */ });
                    });
                }
            }
        }

        // Load audio — optional. Songs without song.ogg (e.g. piano-only charts) run
        // with a no-op clock player so all scene and UI logic continues to work.
        let player: ISongPlayer;
        try {
            const audioFile = await this.library.getSongFile(this.entry, 'song.ogg');
            this.audioUrl = URL.createObjectURL(audioFile);
            const songPlayer = new SongPlayer();
            await songPlayer.loadSong(this.audioUrl);
            URL.revokeObjectURL(this.audioUrl);
            this.audioUrl = null;
            player = songPlayer;
        } catch {
            player = new SilentPlayer(songInfo.SongLengthSeconds ?? 0);
        }
        this.songPlayer = player;

        this.totalDuration = player.duration > 0 ? player.duration : (songInfo.SongLengthSeconds ?? 0);

        if (settings.skipIntro && notes0TimeOffset > 0) {
            this.scene.currentSecond = notes0TimeOffset;
        }

        this.app.activeScene = this.scene;
        this.songPlayer.play();

        this.app.onSongPause = () => {
            if (!this.songPlayer?.isPlaying) return null;
            const pos = this.songPlayer.currentSecond;
            this.songPlayer.pause();
            return pos;
        };
        // onSongRollback: fires immediately when a resume-with-countdown begins.
        // Starts the scroll-back animation and marks the grace period.
        this.app.onSongRollback = (seconds: number) => {
            if (!this.scene || !this.songPlayer) return;
            // Start animating scene.currentSecond back from where the user seeked to.
            this.rollbackFromTime = this.songPlayer.currentSecond;
            this.rollbackToTime   = seconds;
            this.rollbackStartMs  = performance.now();
            // Mark notes before the seeked-to position as grace notes.
            if (this.scene instanceof FretPlayerScene3D) {
                this.scene.gracePeriodEndTime = this.rollbackFromTime;
            }
            // Seek the audio player now so currentSecond reports the right position
            // during the countdown (audio stays paused, position is just updated).
            this.songPlayer.seekTo(seconds);
            // Reset scoring so grace-period notes don't count against the player.
            this.noteDetector?.reset();
        };
        // onSongResume: fires after the countdown completes — audio only.
        // Scene position was already set by onSongRollback / animation.
        this.app.onSongResume = (seconds: number) => {
            this.songPlayer?.seekTo(seconds);
            this.songPlayer?.play();
        };
        this.app.onSettingsChange = (s) => {
            if (this.scene instanceof FretPlayerScene3D) {
                this.scene.boldText      = s.boldText;
                this.scene.invertStrings = s.invertStrings;
                this.scene.leftyMode     = s.leftyMode;
            } else if (this.scene instanceof KeysPlayerScene3D) {
                this.scene.minKey = s.fullKeyboard ? 21 : this.keysNoteMin;
                this.scene.maxKey = s.fullKeyboard ? 108 : this.keysNoteMax;
                this.scene.syncHighwayBounds();
                this.scene.topDown        = s.keysTopDown;
                this.scene.rightHandColor = fromHex(s.keysRightHandColor);
                this.scene.leftHandColor  = fromHex(s.keysLeftHandColor);
            }
        };

        this.buildOverlay(container, this.scene instanceof KeysPlayerScene3D ? this.scene : null);

        // Press M to toggle mock detection (2 hits / 1 miss cycle).
        this.mockKeyHandler = (e: KeyboardEvent) => {
            if (e.key !== 'm' && e.key !== 'M') return;
            if (!(this.scene instanceof FretPlayerScene3D)) return;
            this.scene.mockDetection = !this.scene.mockDetection;
            this.scene.resetMockDetection();
        };
        window.addEventListener('keydown', this.mockKeyHandler);
    }

    private buildOverlay(container: HTMLElement, keysScene: KeysPlayerScene3D | null = null): void {
        const dur = this.totalDuration;
        const durStr = formatTime(dur);

        container.innerHTML = `
            <div id="active-overlay">
                <div class="active-bar">
                    <button class="active-back-btn" id="active-back">&#8592; Library</button>
                    <button class="active-play-btn" id="active-play">&#9646;&#9646;</button>
                    <span class="active-time" id="active-time">0:00</span>
                    <div class="active-seek-wrap">
                        <input type="range" id="active-seek" min="0" max="1000" step="1" value="0" />
                        <div id="active-sections"></div>
                    </div>
                    <span class="active-duration">${durStr}</span>
                    <div class="speed-group">
                        <button class="speed-step" id="speed-down">&#x2212;</button>
                        <select id="active-speed-select"></select>
                        <button class="speed-step" id="speed-up">+</button>
                    </div>
                </div>
            </div>`;

        // Piano calibration panel — only for keys scenes so the piano image can be
        // aligned to the physical keyboard. Sliders drive KeysPlayerScene3D properties live.
        if (keysScene) {
            const calPanel = document.createElement('div');
            calPanel.style.cssText = [
                'position:absolute', 'bottom:16px', 'left:16px', 'z-index:10',
                'background:rgba(0,0,0,0.75)', 'border:1px solid #333', 'border-radius:8px',
                'padding:10px 14px', 'color:#fff', 'font-family:system-ui,sans-serif',
                'font-size:12px', 'display:flex', 'flex-direction:column', 'gap:6px',
                'min-width:220px', 'pointer-events:auto',
            ].join(';');
            calPanel.innerHTML = `
                <div style="font-weight:600;margin-bottom:2px;">Piano image</div>
                <label style="display:flex;align-items:center;gap:8px;">
                    <span style="min-width:36px">Scale</span>
                    <input id="pcal-scale" type="range" min="0.5" max="3" step="0.01" value="1" style="flex:1" />
                    <span id="pcal-scale-val" style="min-width:34px;text-align:right">1.00</span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;">
                    <span style="min-width:36px">X</span>
                    <input id="pcal-x" type="range" min="-500" max="500" step="1" value="0" style="flex:1" />
                    <span id="pcal-x-val" style="min-width:34px;text-align:right">0</span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;">
                    <span style="min-width:36px">Y</span>
                    <input id="pcal-y" type="range" min="-200" max="400" step="1" value="0" style="flex:1" />
                    <span id="pcal-y-val" style="min-width:34px;text-align:right">0</span>
                </label>`;
            container.appendChild(calPanel);

            const scaleEl = calPanel.querySelector('#pcal-scale') as HTMLInputElement;
            const xEl     = calPanel.querySelector('#pcal-x')     as HTMLInputElement;
            const yEl     = calPanel.querySelector('#pcal-y')     as HTMLInputElement;
            const scaleV  = calPanel.querySelector('#pcal-scale-val') as HTMLElement;
            const xV      = calPanel.querySelector('#pcal-x-val')     as HTMLElement;
            const yV      = calPanel.querySelector('#pcal-y-val')     as HTMLElement;

            scaleEl.addEventListener('input', () => {
                keysScene.pianoScale = Number(scaleEl.value);
                scaleV.textContent = Number(scaleEl.value).toFixed(2);
            });
            xEl.addEventListener('input', () => {
                keysScene.pianoOffsetX = Number(xEl.value);
                xV.textContent = xEl.value;
            });
            yEl.addEventListener('input', () => {
                keysScene.pianoOffsetZ = Number(yEl.value);
                yV.textContent = yEl.value;
            });
        }

        const overlay  = container.querySelector('#active-overlay') as HTMLElement;
        const seekEl   = container.querySelector('#active-seek') as HTMLInputElement;
        const timeEl   = container.querySelector('#active-time') as HTMLElement;
        const playBtn  = container.querySelector('#active-play') as HTMLButtonElement;
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

        seekEl.addEventListener('pointerdown', () => {
            isScrubbing = true;
            wasPlayingBeforeScrub = this.songPlayer?.isPlaying ?? false;
            if (wasPlayingBeforeScrub) this.songPlayer?.pause();
        });
        seekEl.addEventListener('input', () => {
            const t = Number(seekEl.value) / 1000 * dur;
            timeEl.textContent = formatTime(t);
            if (this.scene) this.scene.currentSecond = t;
        });
        seekEl.addEventListener('pointerup', () => {
            const t = Number(seekEl.value) / 1000 * dur;
            // Always seek the scene to the scrubbed position.
            this.songPlayer?.seekTo(t);
            if (wasPlayingBeforeScrub) {
                // Resume via the same 3-2-1 countdown used when closing settings.
                this.app.resumeWithCountdown(t);
                scheduleHide();
            } else {
                showBar(); // stay visible when scrubbing while paused
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
        // Dropdown shows the 8 named presets. +/- step at 0.05 through 0.05–2.00;
        // if the result isn't a preset the dropdown shows blank — that's intentional.
        const speedSelect = container.querySelector('#active-speed-select') as HTMLSelectElement;
        const SPEED_MIN  = 0.05, SPEED_MAX = 2.0, SPEED_STEP = 0.05;
        const SPEED_PRESET_STEP = 0.2;
        // Dropdown shows multiples of 0.2 as the named presets.
        // A dynamic "custom" option is inserted at the top when the user steps
        // to a value between presets via the +/- buttons.
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
                // Insert/update a custom option at the top so the dropdown preview shows
                // the exact current speed even though it isn't one of the presets.
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
            const library = this.library;
            import('./SongLibraryScreen').then(({ SongLibraryScreen }) => {
                this.app.navigate(new SongLibraryScreen(this.app, this.texture, library));
            });
        });

        // onPreDraw: keep seek bar and play button in sync with audio clock.
        // During the scroll-back animation, scene.currentSecond is driven by the
        // eased animation rather than the audio clock.
        this.app.onPreDraw = () => {
            if (!this.scene || !this.songPlayer) return;

            // Drive note detection every frame — NoteDetector handles miss sweep
            // and hit matching against the current song position.
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
                this.scene.currentSecond = displayTime;
                if (progress >= 1) { this.rollbackFromTime = null; this.rollbackToTime = null; }
            } else {
                displayTime = this.songPlayer.currentSecond;
                this.scene.currentSecond = displayTime;
            }

            if (!isScrubbing && dur > 0) {
                seekEl.value = String(Math.round(displayTime / dur * 1000));
                timeEl.textContent = formatTime(displayTime);
            }

            const playing = this.songPlayer.isPlaying;
            playBtn.textContent = playing ? '⏸' : '▶';

            // Song just ended naturally — show bar so user can navigate away
            if (prevIsPlaying && !playing) showBar();
            prevIsPlaying = playing;
        };
    }

    unmount(): void {
        if (this.mockKeyHandler) { window.removeEventListener('keydown', this.mockKeyHandler); this.mockKeyHandler = null; }
        this.songPlayer?.pause();
        this.scene?.destroy();
        if (this.ownsPitchDetector) this.pitchDetector?.destroy();
        this.pitchDetector = null;
        this.noteDetector  = null;
        if (this.audioUrl) { URL.revokeObjectURL(this.audioUrl); this.audioUrl = null; }
        this.rollbackFromTime = null;
        this.rollbackToTime   = null;
        this.app.activeScene           = null;
        this.app.activeInstrumentType  = null;
        this.app.onPreDraw             = null;
        this.app.onSongPause       = null;
        this.app.onSongRollback    = null;
        this.app.onSongResume      = null;
        this.app.onSettingsChange  = null;
        if (this.container) this.container.innerHTML = '';
        this.scene      = null;
        this.songPlayer = null;
        this.container  = null;
    }
}
