import html2canvas from "html2canvas";
import {
    AssetManifest,
    AssetType,
    AssetManager,
    CanvasTexture,
    InputComponent,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    OneHandGrabbable,
    PlaneGeometry,
    Raycaster,
    RayInteractable,
    SessionMode,
    Vector3,
    World,
    createSystem,
} from "@iwsdk/core";

import { loadManifest } from "./UIImage.js";
import { FretPlayerScene3D } from "./FretPlayerScene3D.js";
import { KeysPlayerScene3D } from "./KeysPlayerScene3D.js";
import { SongPlayer } from "./SongPlayer.js";
import { CalibrationSystem } from "./CalibrationSystem.js";
import { XRSongLibrary, type SongManifestEntry } from "./XRSongLibrary.js";
import { XRPreScene } from "./XRPreScene.js";
import { XRActiveScene } from "./XRActiveScene.js";
import type { XrButton } from "./XRTypes.js";
import type { SongStructure, SongKeyboardNotes, SongSection, SongInfo } from "./SongFormat.js";

// ── Asset paths ───────────────────────────────────────────────────────────────

const ATLAS_URL =
    "/@fs/D:/Users/Andrew/Documents/Coding/MusicThing/ChartPlayer/ChartPlayerShared/Content/Textures/UISheet0.png";

const IMAGE_MANIFEST_URL = "/ImageManifest.json";
const SONG_MANIFEST_URL  = "/songs/manifest.json";

// ── IWSDK HighwaySystem ───────────────────────────────────────────────────────

class HighwaySystem extends createSystem({}) {
    private raycaster!: Raycaster;
    private rayOrigin!: Vector3;
    private rayDir!: Vector3;

    private lastPanelRender = -999;
    private panelRenderPending = false;

    // Scrub state — active while the user holds trigger over the seek bar.
    private scrubBtn: XrButton | null = null;
    private scrubHandIdx = -1; // index into hands[] array; -1 = not scrubbing
    private scrubLastX = 0;

    init(): void {
        this.raycaster = new Raycaster();
        this.rayOrigin = new Vector3();
        this.rayDir    = new Vector3();
    }

    update(delta: number, time: number): void {
        // ── Highway scene — only when a song is loaded ────────────────────────
        const scene = this.world.globals.highwayScene as FretPlayerScene3D | KeysPlayerScene3D | undefined;
        if (scene) {
            type RollbackState = { from: number; to: number; startMs: number };
            const rollback = this.world.globals.rollbackState as RollbackState | undefined;
            if (rollback) {
                const elapsed  = (performance.now() - rollback.startMs) / 1000;
                const progress = Math.min(elapsed / 0.8, 1);
                const eased    = 1 - Math.pow(1 - progress, 3);
                scene.currentSecond = rollback.from + (rollback.to - rollback.from) * eased;
                if (progress >= 1) this.world.globals.rollbackState = undefined;
            } else {
                const songPlayer = this.world.globals.songPlayer as SongPlayer | undefined;
                if (songPlayer) {
                    scene.currentSecond = songPlayer.currentSecond;
                } else {
                    scene.currentSecond += delta;
                }
            }
            scene.draw(delta);
        }

        // ── Panel: throttled html2canvas render (~10 fps) ─────────────────────
        // Runs regardless of whether a song is loaded — the panel shows library/
        // pre-scene/active screens at all times.
        const uiPanel   = this.world.globals.uiPanel   as HTMLDivElement  | undefined;
        const panelTex  = this.world.globals.panelTex  as CanvasTexture   | undefined;
        const xrButtons = this.world.globals.xrButtons as XrButton[]      | undefined;
        const panelMesh = this.world.globals.panelMesh as Mesh            | undefined;

        if (uiPanel && panelTex && !this.panelRenderPending
                && time - this.lastPanelRender > 0.1) {
            // Let the active scene update seek-bar position and time label before capture.
            (this.world.globals.updateActivePanel as (() => void) | undefined)?.();
            this.panelRenderPending = true;
            this.lastPanelRender = time;
            html2canvas(uiPanel, { backgroundColor: null, logging: false }).then(canvas => {
                const dst = panelTex.image as HTMLCanvasElement;
                dst.getContext("2d")!.drawImage(canvas, 0, 0, dst.width, dst.height);
                panelTex.needsUpdate = true;
                this.panelRenderPending = false;
            }).catch(() => { this.panelRenderPending = false; });
        }

        // ── Ray hit-test: scrub drag and button clicks ────────────────────────
        const hands = [
            { pad: this.input.gamepads.left,  ray: this.player.raySpaces.left },
            { pad: this.input.gamepads.right, ray: this.player.raySpaces.right },
        ] as const;

        // Helper: cast the active ray against the panel; return normalised X within
        // el (clamped 0–1), or null if the ray misses the panel entirely.
        const rayNormX = (
            ray: (typeof hands)[number]['ray'],
            el: HTMLElement,
        ): number | null => {
            if (!panelMesh || !uiPanel || !ray) return null;
            ray.updateMatrixWorld();
            panelMesh.updateMatrixWorld();
            ray.getWorldPosition(this.rayOrigin);
            this.rayDir.set(0, 0, -1).transformDirection(ray.matrixWorld);
            this.raycaster.set(this.rayOrigin, this.rayDir);
            const hits = this.raycaster.intersectObject(panelMesh);
            if (hits.length === 0 || !hits[0].uv) return null;
            const panelRect = uiPanel.getBoundingClientRect();
            const pixX = hits[0].uv.x * panelRect.width;
            const r    = el.getBoundingClientRect();
            return Math.max(0, Math.min((pixX - (r.left - panelRect.left)) / r.width, 1));
        };

        // ── Active scrub: move or end ─────────────────────────────────────────
        if (this.scrubBtn !== null && this.scrubHandIdx >= 0) {
            const { pad, ray } = hands[this.scrubHandIdx];
            if (pad?.getButtonPressed(InputComponent.Trigger)) {
                // Trigger still held — update scrub position.
                const nx = rayNormX(ray, this.scrubBtn.el);
                if (nx !== null && nx !== this.scrubLastX) {
                    this.scrubLastX = nx;
                    this.scrubBtn.onScrubMove?.(nx);
                }
            } else {
                // Trigger released — finalise at last known position.
                this.scrubBtn.onScrubEnd?.(this.scrubLastX);
                this.scrubBtn     = null;
                this.scrubHandIdx = -1;
            }
            return; // don't start new clicks while scrubbing
        }

        // ── New button press ──────────────────────────────────────────────────
        for (let i = 0; i < hands.length; i++) {
            const { pad, ray } = hands[i];
            if (!pad?.getButtonDown(InputComponent.Trigger)) continue;
            if (!panelMesh || !uiPanel || !xrButtons || !ray) continue;

            ray.updateMatrixWorld();
            panelMesh.updateMatrixWorld();
            ray.getWorldPosition(this.rayOrigin);
            this.rayDir.set(0, 0, -1).transformDirection(ray.matrixWorld);
            this.raycaster.set(this.rayOrigin, this.rayDir);

            const hits = this.raycaster.intersectObject(panelMesh);
            if (hits.length === 0 || !hits[0].uv) continue;

            const panelRect = uiPanel.getBoundingClientRect();
            const pixX      = hits[0].uv.x * panelRect.width;
            const pixY      = (1 - hits[0].uv.y) * panelRect.height;

            for (const btn of xrButtons) {
                const r  = btn.el.getBoundingClientRect();
                const bx = r.left - panelRect.left;
                const by = r.top  - panelRect.top;
                if (pixX >= bx && pixX <= bx + r.width
                        && pixY >= by && pixY <= by + r.height) {
                    if (btn.onScrubStart) {
                        // Enter scrub mode.
                        this.scrubLastX   = Math.max(0, Math.min((pixX - bx) / r.width, 1));
                        this.scrubHandIdx = i;
                        this.scrubBtn     = btn;
                        btn.onScrubStart();
                    } else {
                        btn.onClick?.();
                    }
                    break;
                }
            }
        }
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const assets: AssetManifest = {
    atlas: { url: ATLAS_URL, type: AssetType.Texture, priority: "critical" },
};

World.create(document.getElementById("scene-container") as HTMLDivElement, {
    assets,
    xr: {
        sessionMode: SessionMode.ImmersiveAR,
        offer: "always",
        features: { handTracking: true, layers: true },
    },
    features: {
        locomotion: false,
        grabbing: true,
        physics: false,
        sceneUnderstanding: true,
        environmentRaycast: false,
    },
}).then(async (world) => {
    const texture  = AssetManager.getTexture("atlas")!;

    const fetchJson = <T>(url: string): Promise<T> =>
        fetch(url).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
            const ct = r.headers.get('content-type') ?? '';
            if (!ct.includes('json')) throw new Error(`Expected JSON, got ${ct} from ${url}`);
            return r.json() as Promise<T>;
        });

    // Load image manifest and song manifest in parallel.
    const [songManifest] = await Promise.all([
        fetchJson<SongManifestEntry[]>(SONG_MANIFEST_URL),
        loadManifest(IMAGE_MANIFEST_URL),
    ]);

    // ── Anchor (empty — highway mesh attached after song selection) ───────────
    const anchor = new Object3D();
    anchor.scale.setScalar(0.003);
    anchor.position.set(-0.45, 0.8, -0.5);
    const anchorEntity = world.createTransformEntity(anchor, {
        parent: world.sceneEntity,
        persistent: true,
    });
    anchorEntity.addComponent(RayInteractable);
    anchorEntity.addComponent(OneHandGrabbable, {});
    world.globals.anchor = anchor;

    // ── UI panel ──────────────────────────────────────────────────────────────
    const uiPanel = document.createElement("div");
    uiPanel.style.cssText = [
        "position:fixed", "left:-9999px", "top:0",
        "width:400px", "height:300px", "background:#1a1a2e",
        "color:#e8e8e8", "font-family:sans-serif", "padding:0",
        "box-sizing:border-box", "border-radius:8px",
    ].join(";");
    document.body.appendChild(uiPanel);

    const panelCanvas = document.createElement("canvas");
    panelCanvas.width  = 400;
    panelCanvas.height = 300;
    const panelTex = new CanvasTexture(panelCanvas);

    const panelMesh = new Mesh(
        new PlaneGeometry(0.4, 0.3),
        new MeshBasicMaterial({ map: panelTex, transparent: true }),
    );
    panelMesh.position.set(0.25, 1.3, -0.6);

    const panelEntity = world.createTransformEntity(panelMesh, {
        parent: world.sceneEntity,
        persistent: true,
    });
    panelEntity.addComponent(RayInteractable);

    const xrButtons: XrButton[] = [];

    world.globals.uiPanel   = uiPanel;
    world.globals.panelMesh = panelMesh;
    world.globals.panelTex  = panelTex;
    world.globals.xrButtons = xrButtons;

    // ── App state machine ─────────────────────────────────────────────────────

    // Tracks the current highway scene entity so we can dispose it before loading
    // a new song. Only the ECS entity wrapper is disposed; the scene's GPU resources
    // are released by GC (acceptable for a prototype).
    let highwayEntity: { dispose(): void } | null = null;

    function clearXrButtons(): void {
        xrButtons.length = 0;
    }

    function showLibrary(): void {
        clearXrButtons();
        // Pause any playing song when returning to the library.
        (world.globals.songPlayer as SongPlayer | undefined)?.pause();
        library.show(uiPanel, xrButtons, showPreScene);
    }

    function showPreScene(entry: SongManifestEntry): void {
        clearXrButtons();
        preScene.show(
            uiPanel,
            xrButtons,
            entry,
            () => (world.globals.tryLoadCalibration as (() => boolean) | undefined)?.() ?? false,
            playEntry,
            calibrateAndPlay,
            showLibrary,
        );
    }

    // Shared song-load logic. Disposes any previous highway, fetches data,
    // creates the scene, and attaches it to the anchor. Returns null if unsupported.
    async function loadSong(
        entry: SongManifestEntry,
        partName: string,
    ): Promise<{ songPlayer: SongPlayer; sections: SongSection[]; totalDuration: number } | null> {
        if (highwayEntity) {
            highwayEntity.dispose();
            highwayEntity = null;
        }
        world.globals.highwayScene = undefined;
        world.globals.songPlayer   = undefined;

        const part = entry.parts.find(p => p.name === partName);
        if (!part || part.type !== 'Keys') return null; // XRProto v1: Keys only

        const SONG_BASE  = `/songs/${entry.folder}`;
        const songPlayer = new SongPlayer();

        const [songStructure, rawNotes, songInfo] = await Promise.all([
            fetchJson<SongStructure>(`${SONG_BASE}/arrangement.json`),
            fetchJson<SongKeyboardNotes>(`${SONG_BASE}/${partName}.json`),
            fetchJson<SongInfo>(`${SONG_BASE}/song.json`),
            songPlayer.loadSong(`${SONG_BASE}/song.ogg`).catch(() => {}),
        ]) as [SongStructure, SongKeyboardNotes, SongInfo, void];

        const scene = new KeysPlayerScene3D(world.renderer, texture, songStructure, rawNotes);
        const firstNoteTime = rawNotes.Notes[0]?.TimeOffset ?? 0;
        if (firstNoteTime > 0) songPlayer.seekTo(firstNoteTime);
        scene.currentSecond = songPlayer.currentSecond;

        highwayEntity = world.createTransformEntity(scene.mesh, {
            parent: anchorEntity,
            persistent: true,
        });
        world.globals.highwayScene = scene;
        world.globals.songPlayer   = songPlayer;

        const totalDuration = songPlayer.duration > 0
            ? songPlayer.duration
            : (songInfo.SongLengthSeconds ?? 0);

        return { songPlayer, sections: rawNotes.Sections ?? [], totalDuration };
    }

    // Saved calibration path: load song then go straight to active scene.
    async function playEntry(entry: SongManifestEntry, partName: string): Promise<void> {
        clearXrButtons();
        uiPanel.innerHTML = `
            <div style="font-size:18px;padding:24px;text-align:center;
                        color:#e8e8e8;font-family:sans-serif">⏳ Loading…</div>`;

        const result = await loadSong(entry, partName);
        if (!result) { showLibrary(); return; }
        showActiveScene(entry, result.songPlayer, result.sections, result.totalDuration);
    }

    // No saved calibration path: load song first (highway visible), then calibrate.
    async function calibrateAndPlay(entry: SongManifestEntry, partName: string): Promise<void> {
        clearXrButtons();
        uiPanel.innerHTML = `
            <div style="font-size:18px;padding:24px;text-align:center;
                        color:#e8e8e8;font-family:sans-serif">⏳ Loading…</div>`;

        const result = await loadSong(entry, partName);
        if (!result) { showLibrary(); return; }
        const { songPlayer, sections, totalDuration } = result;

        // Highway is now attached to the anchor and rendering — start calibration
        // so the user can see the highway move into alignment as they calibrate.
        (world.globals.startCalibration as ((d: () => void) => void) | undefined)?.(
            () => showActiveScene(entry, songPlayer, sections, totalDuration),
        );
    }

    function showActiveScene(
        entry: SongManifestEntry,
        songPlayer: SongPlayer,
        sections: SongSection[],
        totalDuration: number,
    ): void {
        clearXrButtons();
        world.globals.updateActivePanel = undefined;
        activeScene.show(
            uiPanel,
            xrButtons,
            entry.title,
            songPlayer,
            totalDuration,
            sections,
            (done: () => void) => {
                (world.globals.recalibrate as ((d: () => void) => void) | undefined)?.(done);
            },
            (pausedAt: number) => resumeWithCountdown(pausedAt, entry, songPlayer, sections, totalDuration),
            (cb: () => void) => { world.globals.updateActivePanel = cb; },
            () => {
                songPlayer.pause();
                world.globals.updateActivePanel = undefined;
                showLibrary();
            },
        );
    }

    // 3-2-1 countdown with 3s scroll-back animation on resume.
    function resumeWithCountdown(
        pausedAt: number,
        entry: SongManifestEntry,
        songPlayer: SongPlayer,
        sections: SongSection[],
        totalDuration: number,
    ): void {
        const resumeAt = Math.max(0, pausedAt - 3);

        // Pause audio and seek to the rollback position.
        songPlayer.pause();
        songPlayer.seekTo(resumeAt);

        // Drive scene.currentSecond backward via HighwaySystem rollback animation.
        world.globals.rollbackState = { from: pausedAt, to: resumeAt, startMs: performance.now() };

        // Replace panel with countdown; no XR buttons during countdown.
        clearXrButtons();
        world.globals.updateActivePanel = undefined;

        const showCount = (n: number) => {
            uiPanel.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;
                            height:100%;font-size:80px;color:#e8e8e8;font-family:sans-serif">
                    ${n}
                </div>`;
        };

        showCount(3);
        setTimeout(() => showCount(2), 1000);
        setTimeout(() => showCount(1), 2000);
        setTimeout(() => {
            songPlayer.play();
            showActiveScene(entry, songPlayer, sections, totalDuration);
        }, 3000);
    }

    // ── Screens ───────────────────────────────────────────────────────────────

    const library    = new XRSongLibrary(songManifest);
    const preScene   = new XRPreScene();
    const activeScene = new XRActiveScene();

    // ── Systems ───────────────────────────────────────────────────────────────

    world.registerSystem(CalibrationSystem);
    world.registerSystem(HighwaySystem);

    // ── Initial state ─────────────────────────────────────────────────────────

    showLibrary();

    // ── Keyboard shortcuts (desktop / device mode) ────────────────────────────

    document.addEventListener("keydown", (e) => {
        if (e.code === "Space" && !e.repeat) {
            e.preventDefault();
            const sp = world.globals.songPlayer as SongPlayer | undefined;
            if (sp) { if (sp.isPlaying) sp.pause(); else sp.play(); }
        }
        if (e.code === "KeyV" && !e.repeat) {
            world.launchXR();
        }
    });

}).catch((err: unknown) => {
    console.error('[XRProto] World.create or bootstrap failed:', err);
});
