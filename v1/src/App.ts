import * as THREE from "three";
import type { Scene3D } from "./Scene3D";
import { loadSettings, saveSettings, type Settings } from "./Settings";
import type { SongIndexPart } from "./SongIndex";

export interface IScreen {
    mount(container: HTMLElement): void | Promise<void>;
    unmount(): void;
}

export class App {
    readonly renderer: THREE.WebGLRenderer;

    // Set by ActiveSceneScreen when a song is active; cleared on unmount.
    activeScene: Scene3D | null = null;

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
            s.invertStrings = (document.getElementById("s-invert-strings") as HTMLInputElement).checked;
            s.boldText      = (document.getElementById("s-bold-text")      as HTMLInputElement).checked;
            saveSettings(s);
            this.onSettingsChange?.(s);
        };
        document.getElementById("s-invert-strings")!.addEventListener("change", onToggle);
        document.getElementById("s-bold-text")!      .addEventListener("change", onToggle);

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

    openSettings(): void {
        this.songPausedBySettings = false;
        if (this.onSongPause) {
            const pos = this.onSongPause();
            if (pos !== null) {
                this.pausedAtSeconds = pos;
                this.songPausedBySettings = true;
            }
        }
        // Sync checkboxes to current persisted values each time the panel opens.
        const s = loadSettings();
        (document.getElementById("s-invert-strings") as HTMLInputElement).checked = s.invertStrings;
        (document.getElementById("s-bold-text")      as HTMLInputElement).checked = s.boldText;
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
