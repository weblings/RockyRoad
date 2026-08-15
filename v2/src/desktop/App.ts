import * as THREE from "three";
import type { Scene3D } from "../shared/Scene3D";
import { loadSettings, saveSettings, type Settings } from "../shared/Settings";
import type { SongIndexPart } from "../shared/SongIndex";
import { Dropdown, type DropdownOption } from "./Dropdown";

export interface IScreen {
    mount(container: HTMLElement): void | Promise<void>;
    unmount(): void;
}

// Note Numbers — percentage dropdown (0%–200% in 20% steps), same shape/step convention as
// ActiveSceneScreen's Speed dropdown.
const NOTE_NUM_STEP = 0.2, NOTE_NUM_MAX = 2.0;
const noteNumLabel = (v: number) => `${Math.round(v * 100)}%`;
const noteNumPresets: number[] = [];
for (let r = 0; r <= NOTE_NUM_MAX + 0.001; r += NOTE_NUM_STEP) {
    noteNumPresets.push(Math.round(r / NOTE_NUM_STEP) * NOTE_NUM_STEP);
}

export class App {
    readonly renderer: THREE.WebGLRenderer;

    // Set by ActiveSceneScreen when a song is active; cleared on unmount.
    activeScene: Scene3D | null = null;

    // Set by ActiveSceneScreen so openSettings() can show/hide instrument-specific sections.
    activeInstrumentType: string | null = null;

    // Called each frame before draw — ActiveSceneScreen uses this to inject currentSecond.
    onPreDraw: (() => void) | null = null;

    // Set by ActiveSceneScreen so App can pause/resume during settings.
    // onSongPause: pause the song and return current position, or null if not playing.
    onSongPause: (() => number | null) | null = null;
    // onSongRollback: called immediately when a resume-with-countdown begins,
    // so the scene scrolls back to the rolled-back position before the 3-2-1 starts.
    onSongRollback: ((seconds: number) => void) | null = null;
    onSongResume: ((seconds: number) => void) | null = null;

    // Called when a settings toggle changes — ActiveSceneScreen uses this to live-update the scene.
    onSettingsChange: ((settings: Settings) => void) | null = null;

    // Stringified StringSemitoneOffsets of the last instrument that passed through the tuner.
    // null = first song of session; updated on every tuner exit (complete or skip).
    lastTuningKey: string | null = null;

    // Returns true if the tuner should auto-fire before playing this part.
    // False for non-stringed instruments or if tuning hasn't changed since last time.
    shouldAutoTune(part: SongIndexPart): boolean {
        if (!part.tuningOffsets) return false;
        return this.lastTuningKey !== JSON.stringify(part.tuningOffsets);
    }

    private lastTime = 0;
    private currentScreen: IScreen | null = null;
    private screenContainer: HTMLElement;
    private settingsOverlay: HTMLElement;
    private countdownOverlay: HTMLElement;
    private songPausedBySettings = false;
    private pausedAtSeconds = 0;
    private noteNumbersDropdown: Dropdown | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(devicePixelRatio);

        this.screenContainer  = document.getElementById("screen-container")!;
        this.settingsOverlay  = document.getElementById("settings-overlay")!;
        this.countdownOverlay = document.getElementById("countdown-overlay")!;

        document.getElementById("settings-btn")
            ?.addEventListener("click", () => this.openSettings());
        document.getElementById("settings-close")!
            .addEventListener("click", () => this.closeSettings());
        document.getElementById("settings-scrim")!
            .addEventListener("click", () => this.closeSettings());

        // Settings panel toggles — save and live-update the active scene whenever changed.
        const onToggle = () => {
            const s = loadSettings();
            s.invertStrings      = (document.getElementById("s-invert-strings")  as HTMLInputElement).checked;
            s.boldText           = (document.getElementById("s-bold-text")        as HTMLInputElement).checked;
            s.leftyMode          = (document.getElementById("s-lefty-mode")       as HTMLInputElement).checked;
            s.fullKeyboard       = (document.getElementById("s-full-keyboard")    as HTMLInputElement).checked;
            s.keysTopDown        = (document.getElementById("s-keys-top-down")    as HTMLInputElement).checked;
            s.keysRightHandColor = (document.getElementById("s-keys-right-color") as HTMLInputElement).value;
            s.keysLeftHandColor  = (document.getElementById("s-keys-left-color")  as HTMLInputElement).value;
            saveSettings(s);
            this.onSettingsChange?.(s);
        };
        document.getElementById("s-invert-strings")!  .addEventListener("change", onToggle);
        document.getElementById("s-bold-text")!        .addEventListener("change", onToggle);
        document.getElementById("s-lefty-mode")!       .addEventListener("change", onToggle);
        document.getElementById("s-full-keyboard")!    .addEventListener("change", onToggle);
        document.getElementById("s-keys-top-down")!    .addEventListener("change", onToggle);
        document.getElementById("s-keys-right-color")! .addEventListener("input",  onToggle);
        document.getElementById("s-keys-left-color")!  .addEventListener("input",  onToggle);

        // Note Numbers — built here (not per-screen) since the Settings overlay itself is
        // App-owned and persists across every screen mount/unmount.
        this.noteNumbersDropdown = new Dropdown(
            document.getElementById("s-note-numbers-slot")!, '',
            (value) => {
                const v = Number(value);
                const s = loadSettings();
                s.noteNumbersDesktop = v;
                saveSettings(s);
                this.onSettingsChange?.(s);
                this.refreshNoteNumbersDropdown(v);
            },
        );
        this.refreshNoteNumbersDropdown(loadSettings().noteNumbersDesktop);

        // DEBUG — press H to download the current screen HTML for inspection / Figma reference.
        // Remove before shipping.
        document.addEventListener('keydown', (e) => {
            if (e.code !== 'KeyH' || e.repeat) return;
            const styles = Array.from(document.querySelectorAll('style'))
                .map(s => `<style>${s.textContent}</style>`)
                .join('\n');
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${styles}</head>` +
                `<body><!-- DEBUG EXPORT: screen-container innerHTML -->${this.screenContainer.innerHTML}</body></html>`;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            a.download = 'screen-debug.html';
            a.click();
        });

        new ResizeObserver(() => this.onResize()).observe(canvas);
        this.onResize();

        requestAnimationFrame(t => this.loop(t));
    }

    navigate(screen: IScreen): void {
        this.currentScreen?.unmount();
        this.renderer.clear();
        this.currentScreen = screen;
        screen.mount(this.screenContainer);
    }

    // Called by ActiveSceneScreen when the user manually resumes after a pause
    // (play button click or seek bar release). Mirrors the settings-close countdown.
    resumeWithCountdown(pausedAt: number): void {
        if (!this.onSongResume) return;
        const resumeAt = Math.max(0, pausedAt - 3);
        // Roll back the scene immediately so the user can see the upcoming notes
        // during the countdown, not just after it.
        this.onSongRollback?.(resumeAt);
        this.startCountdown(() => this.onSongResume!(resumeAt));
    }

    private refreshNoteNumbersDropdown(v: number): void {
        this.noteNumbersDropdown?.setTriggerLabel(noteNumLabel(v));
        this.noteNumbersDropdown?.setOptions(noteNumPresets.map((p): DropdownOption => ({
            label: noteNumLabel(p), value: p.toFixed(2), selected: Math.abs(p - v) < 0.001,
        })));
    }

    openSettings(): void {
        this.songPausedBySettings = false;
        if (this.onSongPause) {
            const pos = this.onSongPause();
            if (pos !== null) {
                this.pausedAtSeconds = pos;
                this.songPausedBySettings = true;
            }
        }
        // Show only sections relevant to the active instrument.
        const isKeys   = this.activeInstrumentType === 'Keys';
        const isGuitar = this.activeInstrumentType !== null && !isKeys;
        (document.getElementById("s-guitar-only") as HTMLElement).style.display = isGuitar ? '' : 'none';
        (document.getElementById("s-keys-only")   as HTMLElement).style.display = isKeys   ? '' : 'none';

        // Sync controls to current persisted values each time the panel opens.
        const s = loadSettings();
        (document.getElementById("s-invert-strings")  as HTMLInputElement).checked = s.invertStrings;
        (document.getElementById("s-bold-text")        as HTMLInputElement).checked = s.boldText;
        (document.getElementById("s-lefty-mode")       as HTMLInputElement).checked = s.leftyMode;
        this.refreshNoteNumbersDropdown(s.noteNumbersDesktop);
        (document.getElementById("s-full-keyboard")    as HTMLInputElement).checked = s.fullKeyboard;
        (document.getElementById("s-keys-top-down")    as HTMLInputElement).checked = s.keysTopDown;
        (document.getElementById("s-keys-right-color") as HTMLInputElement).value   = s.keysRightHandColor;
        (document.getElementById("s-keys-left-color")  as HTMLInputElement).value   = s.keysLeftHandColor;
        this.settingsOverlay.classList.remove("hidden");
    }

    closeSettings(): void {
        this.settingsOverlay.classList.add("hidden");
        if (this.songPausedBySettings && this.onSongResume) {
            const resumeAt = Math.max(0, this.pausedAtSeconds - 3);
            this.onSongRollback?.(resumeAt);
            this.startCountdown(() => this.onSongResume!(resumeAt));
        }
        this.songPausedBySettings = false;
    }

    private startCountdown(onComplete: () => void): void {
        let count = 3;
        this.countdownOverlay.textContent = String(count);
        this.countdownOverlay.classList.remove("hidden");
        const tick = () => {
            count--;
            if (count <= 0) {
                this.countdownOverlay.classList.add("hidden");
                onComplete();
            } else {
                this.countdownOverlay.textContent = String(count);
                setTimeout(tick, 1000);
            }
        };
        setTimeout(tick, 1000);
    }

    private loop(time: number): void {
        const dt = Math.min((time - this.lastTime) / 1000, 0.1);
        this.lastTime = time;
        this.onPreDraw?.();
        this.activeScene?.draw(dt);
        requestAnimationFrame(t => this.loop(t));
    }

    private onResize(): void {
        const w = this.renderer.domElement.clientWidth;
        const h = this.renderer.domElement.clientHeight;
        this.renderer.setSize(w, h, false);
        this.activeScene?.camera.setViewport(w, h);
    }
}
