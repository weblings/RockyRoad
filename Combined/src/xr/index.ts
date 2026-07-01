import './panel.css';
import './screens/song.css';
import './screens/reposition.css';
import './screens/settings.css';
import './screens/library.css';
import './screens/play.css';

import html2canvas from "html2canvas";
import {
    type AssetManifest,
    AssetType,
    AssetManager,
    CanvasTexture,
    DistanceGrabbable,
    InputComponent,
    Mesh,
    MeshBasicMaterial,
    MovementMode,
    Object3D,
    PlaneGeometry,
    Raycaster,
    RayInteractable,
    SessionMode,
    Vector3,
    World,
    createSystem,
} from "@iwsdk/core";

// Must be set before any scene classes are constructed.
import { Scene3D } from "../shared/Scene3D";
Scene3D.xrMode = true;

import { loadManifest } from "../shared/UIImage";
import { KeysPlayerScene3D } from "../shared/KeysPlayerScene3D";
import { SongPlayer } from "../shared/SongPlayer";
import { CalibrationSystem } from "./CalibrationSystem";
import { XRSongLibrary } from "./XRSongLibrary";
import { loadAllSources, type SourcedEntry } from "../shared/SongSource";
import { XRPreScene } from "./XRPreScene";
import { XRActiveScene } from "./XRActiveScene";
import { XRSettingsScene } from "./XRSettingsScene";
import { loadSettings, type Settings } from "../shared/Settings";
import { fromHex } from "../shared/UIColor";
import type { XrButton } from "./XRTypes";
import type { SongStructure, SongKeyboardNotes, SongSection, SongInfo } from "../shared/SongFormat";

// ── Asset paths ───────────────────────────────────────────────────────────────

const ATLAS_URL = "/UISheet0.png";

const IMAGE_MANIFEST_URL = "/ImageManifest.json";

// ── Panel billboard ───────────────────────────────────────────────────────────
let PANEL_BILLBOARD_LOW_OFFSET  = 0.375;
let PANEL_BILLBOARD_HIGH_OFFSET = 0.375;
let PANEL_PITCH_TWEEN_SECS      = 0.5;

// ── IWSDK HighwaySystem ───────────────────────────────────────────────────────

class HighwaySystem extends createSystem({}) {
    private raycaster!: Raycaster;
    private rayOrigin!: Vector3;
    private rayDir!: Vector3;

    private lastPanelRender = -999;
    private panelRenderPending = false;
    private panelRenderGen = 0;

    private scrubBtn: XrButton | null = null;
    private scrubHandIdx = -1;
    private scrubLastX = 0;

    private hoveredBtn: XrButton | null = null;

    private lastCountdownN: number | undefined = undefined;

    private isGrabbed        = false;
    private grabbingHandIdx  = -1;
    private panelPos!: Vector3;
    private headPos!: Vector3;
    private pitchCurrent      = 0;
    private pitchTarget       = 0;
    private pitchAnimProgress = 1;
    private pitchAnimFrom     = 0;

    init(): void {
        this.raycaster = new Raycaster();
        this.rayOrigin = new Vector3();
        this.rayDir    = new Vector3();
        this.panelPos  = new Vector3();
        this.headPos   = new Vector3();

        this.world.globals.invalidatePanelRender = (): void => {
            this.panelRenderGen++;
            this.panelRenderPending = false;
            this.lastPanelRender = -999;
        };
    }

    update(delta: number, time: number): void {
        // ── Highway scene — only when a song is loaded ────────────────────────
        const scene = this.world.globals.highwayScene as KeysPlayerScene3D | undefined;
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

        // ── Countdown overlay ─────────────────────────────────────────────────
        const countdownN    = this.world.globals.countdownN    as number | undefined;
        const countdownMesh = this.world.globals.countdownMesh as Mesh   | undefined;
        if (countdownMesh) {
            if (countdownN !== undefined && countdownN !== this.lastCountdownN) {
                this.lastCountdownN = countdownN;
                const cv  = this.world.globals.countdownCanvas as HTMLCanvasElement;
                const tex = this.world.globals.countdownTex    as CanvasTexture;
                const ctx = cv.getContext('2d')!;
                ctx.clearRect(0, 0, cv.width, cv.height);
                ctx.beginPath();
                ctx.arc(cv.width / 2, cv.height / 2, cv.width * 0.38, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.45)';
                ctx.fill();
                ctx.font         = `bold ${Math.round(cv.height * 0.55)}px sans-serif`;
                ctx.fillStyle    = '#ffffff';
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor  = 'rgba(0,0,0,0.7)';
                ctx.shadowBlur   = 24;
                ctx.fillText(String(countdownN), cv.width / 2, cv.height / 2);
                tex.needsUpdate = true;
                countdownMesh.visible = true;
            } else if (countdownN === undefined && this.lastCountdownN !== undefined) {
                this.lastCountdownN = undefined;
                countdownMesh.visible = false;
            }
        }

        // ── Panel: throttled html2canvas render (~10 fps) ─────────────────────
        const uiPanel   = this.world.globals.uiPanel   as HTMLDivElement  | undefined;
        const panelTex  = this.world.globals.panelTex  as CanvasTexture   | undefined;
        const xrButtons = this.world.globals.xrButtons as XrButton[]      | undefined;
        const panelMesh = this.world.globals.panelMesh as Mesh            | undefined;

        if (uiPanel && panelTex && !this.panelRenderPending
                && time - this.lastPanelRender > 0.1) {
            (this.world.globals.updateActivePanel as (() => void) | undefined)?.();
            this.panelRenderPending = true;
            this.lastPanelRender = time;
            const captureGen = this.panelRenderGen;
            html2canvas(uiPanel, { backgroundColor: null, logging: false }).then(canvas => {
                if (this.panelRenderGen !== captureGen) {
                    this.panelRenderPending = false;
                    return;
                }
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

        // ── Grab detection + billboard ─────────────────────────────────────────
        const grabBarHit = this.world.globals.grabBarHit as Mesh | undefined;
        if (grabBarHit) {
            if (!this.isGrabbed) {
                for (let i = 0; i < hands.length; i++) {
                    const { pad, ray } = hands[i];
                    if (!pad?.getButtonDown(InputComponent.Trigger) || !ray) continue;
                    ray.updateMatrixWorld();
                    ray.getWorldPosition(this.rayOrigin);
                    this.rayDir.set(0, 0, -1).transformDirection(ray.matrixWorld);
                    this.raycaster.set(this.rayOrigin, this.rayDir);
                    if (panelMesh && this.raycaster.intersectObject(panelMesh).length > 0) continue;
                    if (this.raycaster.intersectObject(grabBarHit).length > 0) {
                        this.isGrabbed       = true;
                        this.grabbingHandIdx = i;
                        (this.input.multiPointers[i === 0 ? 'left' : 'right'] as unknown as { ray: { visual: { enabled: boolean } } }).ray.visual.enabled = false;
                        break;
                    }
                }
            } else if (this.grabbingHandIdx >= 0) {
                if (hands[this.grabbingHandIdx].pad?.getButtonUp(InputComponent.Trigger)) {
                    (this.input.multiPointers[this.grabbingHandIdx === 0 ? 'left' : 'right'] as unknown as { ray: { visual: { enabled: boolean } } }).ray.visual.enabled = true;
                    this.isGrabbed       = false;
                    this.grabbingHandIdx = -1;
                }
            }

            if (this.isGrabbed) {
                grabBarHit.getWorldPosition(this.panelPos);
                this.player.head.getWorldPosition(this.headPos);
                grabBarHit.rotation.y = Math.atan2(
                    this.headPos.x - this.panelPos.x,
                    this.headPos.z - this.panelPos.z,
                );

                const panelCenterY = this.panelPos.y + 0.169;
                const headY = this.headPos.y;
                const newTarget = panelCenterY > headY + PANEL_BILLBOARD_HIGH_OFFSET ?  Math.PI / 6
                                : panelCenterY < headY - PANEL_BILLBOARD_LOW_OFFSET  ? -Math.PI / 6
                                : 0;
                if (newTarget !== this.pitchTarget) {
                    this.pitchAnimFrom     = this.pitchCurrent;
                    this.pitchTarget       = newTarget;
                    this.pitchAnimProgress = 0;
                }
            }

            if (this.pitchAnimProgress < 1) {
                this.pitchAnimProgress = Math.min(1, this.pitchAnimProgress + delta / PANEL_PITCH_TWEEN_SECS);
                const eased = 1 - Math.pow(2, -10 * this.pitchAnimProgress);
                this.pitchCurrent     = this.pitchAnimFrom + (this.pitchTarget - this.pitchAnimFrom) * eased;
                grabBarHit.rotation.x = this.pitchCurrent;
            }
        }

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
                const nx = rayNormX(ray, this.scrubBtn.el);
                if (nx !== null && nx !== this.scrubLastX) {
                    this.scrubLastX = nx;
                    this.scrubBtn.onScrubMove?.(nx);
                }
            } else {
                this.scrubBtn.onScrubEnd?.(this.scrubLastX);
                this.scrubBtn     = null;
                this.scrubHandIdx = -1;
            }
            return;
        }

        // ── Per-frame hover scan ──────────────────────────────────────────────
        if (xrButtons && panelMesh && uiPanel) {
            let newHovered: XrButton | null = null;
            hoverOuter: for (const { ray } of hands) {
                if (!ray) continue;
                ray.updateMatrixWorld();
                panelMesh.updateMatrixWorld();
                ray.getWorldPosition(this.rayOrigin);
                this.rayDir.set(0, 0, -1).transformDirection(ray.matrixWorld);
                this.raycaster.set(this.rayOrigin, this.rayDir);
                const hits = this.raycaster.intersectObject(panelMesh);
                if (hits.length === 0 || !hits[0].uv) continue;
                const panelRect = uiPanel.getBoundingClientRect();
                const pixX = hits[0].uv.x * panelRect.width;
                const pixY = (1 - hits[0].uv.y) * panelRect.height;
                for (const btn of xrButtons) {
                    const r  = btn.el.getBoundingClientRect();
                    const bx = r.left - panelRect.left;
                    const by = r.top  - panelRect.top;
                    if (pixX >= bx && pixX <= bx + r.width && pixY >= by && pixY <= by + r.height) {
                        newHovered = btn;
                        break hoverOuter;
                    }
                }
                break;
            }
            if (newHovered !== this.hoveredBtn) {
                this.hoveredBtn?.el.classList.remove('xr-hover');
                newHovered?.el.classList.add('xr-hover');
                this.hoveredBtn = newHovered;
            }
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
    atlas: { url: ATLAS_URL, type: AssetType.Texture },
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
    const texture = AssetManager.getTexture("atlas") ?? (() => {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#888888';
        ctx.fillRect(0, 0, 64, 64);
        console.warn('[XRProto] Atlas texture failed to load — using fallback grey square');
        return new CanvasTexture(canvas);
    })();

    const fetchJson = <T>(url: string): Promise<T> =>
        fetch(url).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
            const ct = r.headers.get('content-type') ?? '';
            if (!ct.includes('json')) throw new Error(`Expected JSON, got ${ct} from ${url}`);
            return r.json() as Promise<T>;
        });

    const [sourcedEntries] = await Promise.all([
        loadAllSources(loadSettings().remoteServerUrl),
        loadManifest(IMAGE_MANIFEST_URL),
    ]);

    // ── Anchor ────────────────────────────────────────────────────────────────
    const anchor = new Object3D();
    anchor.scale.setScalar(0.003);
    anchor.position.set(-0.45, 0.8, -0.5);
    const anchorEntity = world.createTransformEntity(anchor, {
        parent: world.sceneEntity,
        persistent: true,
    });
    world.globals.anchor = anchor;

    // ── Countdown overlay ─────────────────────────────────────────────────────
    const countdownCanvas = document.createElement('canvas');
    countdownCanvas.width  = 512;
    countdownCanvas.height = 512;
    const countdownTex  = new CanvasTexture(countdownCanvas);
    const countdownMesh = new Mesh(
        new PlaneGeometry(50, 50),
        new MeshBasicMaterial({ map: countdownTex, transparent: true }),
    );
    countdownMesh.position.set(204, 125, -100);
    countdownMesh.visible = false;
    world.createTransformEntity(countdownMesh, { parent: anchorEntity, persistent: true });
    world.globals.countdownMesh   = countdownMesh;
    world.globals.countdownCanvas = countdownCanvas;
    world.globals.countdownTex    = countdownTex;

    // ── UI panel ──────────────────────────────────────────────────────────────
    const uiPanel = document.createElement("div");
    uiPanel.className = 'xr-panel';
    uiPanel.style.cssText = "position:fixed;left:-9999px;top:0;width:400px;height:300px";
    document.body.appendChild(uiPanel);

    const panelCanvas = document.createElement("canvas");
    panelCanvas.width  = 400;
    panelCanvas.height = 300;
    const panelTex = new CanvasTexture(panelCanvas);

    const grabBarCanvas = document.createElement('canvas');
    grabBarCanvas.width  = 200;
    grabBarCanvas.height = 32;
    const gbCtx = grabBarCanvas.getContext('2d')!;
    const W = grabBarCanvas.width, H = grabBarCanvas.height, gbR = 5;
    gbCtx.fillStyle = 'rgba(255,255,255,0.85)';
    gbCtx.beginPath();
    gbCtx.moveTo(gbR, 0);
    gbCtx.lineTo(W - gbR, 0);
    gbCtx.arc(W - gbR, gbR,     gbR, -Math.PI / 2, 0);
    gbCtx.lineTo(W, H - gbR);
    gbCtx.arc(W - gbR, H - gbR, gbR, 0,            Math.PI / 2);
    gbCtx.lineTo(gbR, H);
    gbCtx.arc(gbR,     H - gbR, gbR, Math.PI / 2,  Math.PI);
    gbCtx.lineTo(0, gbR);
    gbCtx.arc(gbR,     gbR,     gbR, Math.PI,       3 * Math.PI / 2);
    gbCtx.closePath();
    gbCtx.fill();

    const grabBarHit = new Mesh(
        new PlaneGeometry(0.2, 0.04),
        new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    grabBarHit.rotation.order = 'YXZ';
    grabBarHit.position.set(0.25, 1.131, -0.6);
    const grabBarEntity = world.createTransformEntity(grabBarHit, {
        parent: world.sceneEntity,
        persistent: true,
    });
    grabBarEntity.addComponent(RayInteractable);
    grabBarEntity.addComponent(DistanceGrabbable, {
        rotate: false,
        scale:  false,
        movementMode: MovementMode.MoveAtSource,
    });

    const grabBarVisual = new Mesh(
        new PlaneGeometry(0.08, 0.008),
        new MeshBasicMaterial({ map: new CanvasTexture(grabBarCanvas), transparent: true }),
    );
    world.createTransformEntity(grabBarVisual, {
        parent: grabBarEntity,
        persistent: true,
    });

    const panelMesh = new Mesh(
        new PlaneGeometry(0.4, 0.3),
        new MeshBasicMaterial({ map: panelTex, transparent: true }),
    );
    panelMesh.position.set(0, 0.169, 0);
    const panelMeshEntity = world.createTransformEntity(panelMesh, {
        parent: grabBarEntity,
        persistent: true,
    });
    panelMeshEntity.addComponent(RayInteractable);

    const xrButtons: XrButton[] = [];

    world.globals.uiPanel    = uiPanel;
    world.globals.panelMesh  = panelMesh;
    world.globals.panelTex   = panelTex;
    world.globals.xrButtons  = xrButtons;
    world.globals.grabBarHit = grabBarHit;

    function resizePanel(w: number, h: number): void {
        uiPanel.style.width  = `${w}px`;
        uiPanel.style.height = `${h}px`;
        if (panelCanvas.width !== w || panelCanvas.height !== h) {
            panelCanvas.width  = w;
            panelCanvas.height = h;
            panelMesh.geometry.dispose();
            panelMesh.geometry = new PlaneGeometry(w * 0.001, h * 0.001);
            panelMesh.position.y = 0.169 + (h - 300) * 0.001 * 0.5;
            panelTex.dispose();
            panelTex.needsUpdate = true;
        }
        (world.globals.invalidatePanelRender as (() => void) | undefined)?.();
    }

    world.globals.resizePanel = resizePanel;

    // ── App state machine ─────────────────────────────────────────────────────

    let highwayEntity: { dispose(): void } | null = null;

    function clearXrButtons(): void {
        for (const btn of xrButtons) btn.el.classList.remove('xr-hover');
        xrButtons.length = 0;
    }

    function showLibrary(): void {
        clearXrButtons();
        resizePanel(1000, 525);
        (world.globals.songPlayer as SongPlayer | undefined)?.pause();
        library.show(uiPanel, xrButtons, showPreScene);
    }

    function showPreScene(sourced: SourcedEntry): void {
        clearXrButtons();
        resizePanel(400, 300);
        preScene.show(
            uiPanel,
            xrButtons,
            sourced,
            () => (world.globals.tryLoadCalibration as (() => boolean) | undefined)?.() ?? false,
            playEntry,
            calibrateAndPlay,
            repositionEntry,
            showLibrary,
        );
    }

    async function loadSong(
        sourced: SourcedEntry,
        partName: string,
    ): Promise<{ songPlayer: SongPlayer; sections: SongSection[]; totalDuration: number; noteMin: number; noteMax: number } | null> {
        if (highwayEntity) {
            highwayEntity.dispose();
            highwayEntity = null;
        }
        world.globals.highwayScene = undefined;
        world.globals.songPlayer   = undefined;

        const { source, entry } = sourced;
        const part = entry.parts.find(p => p.name === partName);
        if (!part || part.type !== 'Keys') return null;

        const songPlayer = new SongPlayer();

        const [songStructure, rawNotes, songInfo] = await Promise.all([
            fetchJson<SongStructure>(source.getFileUrl(entry, 'arrangement.json')),
            fetchJson<SongKeyboardNotes>(source.getFileUrl(entry, `${partName}.json`)),
            fetchJson<SongInfo>(source.getFileUrl(entry, 'song.json')),
            songPlayer.loadSong(source.getFileUrl(entry, 'song.ogg')).catch(() => {}),
        ]) as [SongStructure, SongKeyboardNotes, SongInfo, void];

        const notes   = rawNotes.Notes;
        const noteMin = notes.length > 0
            ? Math.max(21,  Math.min(...notes.map(n => n.Note)) - 1)
            : 21;
        const noteMax = notes.length > 0
            ? Math.min(108, Math.max(...notes.map(n => n.Note)) + 1)
            : 108;

        const scene = new KeysPlayerScene3D(world.renderer, texture, songStructure, rawNotes);

        const saved = loadSettings();
        scene.minKey = saved.fullKeyboard ? 21 : noteMin;
        scene.maxKey = saved.fullKeyboard ? 108 : noteMax;
        scene.syncHighwayBounds();
        scene.rightHandColor = fromHex(saved.keysRightHandColor);
        scene.leftHandColor  = fromHex(saved.keysLeftHandColor);

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

        return { songPlayer, sections: rawNotes.Sections ?? [], totalDuration, noteMin, noteMax };
    }

    async function playEntry(entry: SourcedEntry, partName: string): Promise<void> {
        clearXrButtons();
        uiPanel.innerHTML = `
            <div style="font-size:18px;padding:24px;text-align:center;
                        color:#e8e8e8;font-family:sans-serif">⏳ Loading…</div>`;

        const result = await loadSong(entry, partName);
        if (!result) { showLibrary(); return; }
        const { songPlayer, sections, totalDuration, noteMin, noteMax } = result;
        showActiveScene(entry, songPlayer, sections, totalDuration, noteMin, noteMax);
    }

    async function repositionEntry(entry: SourcedEntry, partName: string): Promise<void> {
        clearXrButtons();
        uiPanel.innerHTML = `
            <div style="font-size:18px;padding:24px;text-align:center;
                        color:#e8e8e8;font-family:sans-serif">⏳ Loading…</div>`;

        const result = await loadSong(entry, partName);
        if (!result) { showLibrary(); return; }
        const { songPlayer, sections, totalDuration, noteMin, noteMax } = result;

        (world.globals.showCalibrationFineTune as ((d: () => void) => void) | undefined)?.(
            () => showActiveScene(entry, songPlayer, sections, totalDuration, noteMin, noteMax),
        );
    }

    async function calibrateAndPlay(entry: SourcedEntry, partName: string): Promise<void> {
        clearXrButtons();
        uiPanel.innerHTML = `
            <div style="font-size:18px;padding:24px;text-align:center;
                        color:#e8e8e8;font-family:sans-serif">⏳ Loading…</div>`;

        const result = await loadSong(entry, partName);
        if (!result) { showLibrary(); return; }
        const { songPlayer, sections, totalDuration, noteMin, noteMax } = result;

        (world.globals.startCalibration as ((d: () => void) => void) | undefined)?.(
            () => showActiveScene(entry, songPlayer, sections, totalDuration, noteMin, noteMax),
        );
    }

    function showActiveScene(
        entry: SourcedEntry,
        songPlayer: SongPlayer,
        sections: SongSection[],
        totalDuration: number,
        noteMin: number,
        noteMax: number,
    ): void {
        clearXrButtons();
        resizePanel(400, 300);
        world.globals.updateActivePanel = undefined;
        activeScene.show(
            uiPanel,
            xrButtons,
            entry.entry.songName,
            entry.entry.artistName,
            songPlayer,
            totalDuration,
            sections,
            (done: () => void) => {
                (world.globals.recalibrate as ((d: () => void) => void) | undefined)?.(done);
            },
            (pausedAt: number) => resumeWithCountdown(pausedAt, entry, songPlayer, sections, totalDuration, noteMin, noteMax),
            () => showSettings(entry, songPlayer, sections, totalDuration, noteMin, noteMax),
            (cb: () => void) => { world.globals.updateActivePanel = cb; },
            () => {
                songPlayer.pause();
                world.globals.updateActivePanel = undefined;
                showLibrary();
            },
        );

        if (!songPlayer.isPlaying) {
            resumeWithCountdown(songPlayer.currentSecond, entry, songPlayer, sections, totalDuration, noteMin, noteMax);
        }
    }

    function showSettings(
        entry: SourcedEntry,
        songPlayer: SongPlayer,
        sections: SongSection[],
        totalDuration: number,
        noteMin: number,
        noteMax: number,
    ): void {
        clearXrButtons();
        resizePanel(400, 300);
        world.globals.updateActivePanel = undefined;
        settingsScene.show(
            uiPanel,
            xrButtons,
            noteMin,
            noteMax,
            (s: Settings) => {
                const scene = world.globals.highwayScene as KeysPlayerScene3D | undefined;
                if (scene) {
                    scene.minKey = s.fullKeyboard ? 21 : noteMin;
                    scene.maxKey = s.fullKeyboard ? 108 : noteMax;
                    scene.syncHighwayBounds();
                    scene.rightHandColor = fromHex(s.keysRightHandColor);
                    scene.leftHandColor  = fromHex(s.keysLeftHandColor);
                }
                showActiveScene(entry, songPlayer, sections, totalDuration, noteMin, noteMax);
            },
        );
    }

    function resumeWithCountdown(
        pausedAt: number,
        entry: SourcedEntry,
        songPlayer: SongPlayer,
        sections: SongSection[],
        totalDuration: number,
        noteMin: number,
        noteMax: number,
    ): void {
        const resumeAt = Math.max(0, pausedAt - 3);

        songPlayer.pause();
        songPlayer.seekTo(resumeAt);

        world.globals.rollbackState = { from: pausedAt, to: resumeAt, startMs: performance.now() };

        clearXrButtons();

        world.globals.countdownN = 3;
        setTimeout(() => { world.globals.countdownN = 2; }, 1000);
        setTimeout(() => { world.globals.countdownN = 1; }, 2000);
        setTimeout(() => {
            world.globals.countdownN = undefined;
            songPlayer.play();
            showActiveScene(entry, songPlayer, sections, totalDuration, noteMin, noteMax);
        }, 3000);
    }

    // ── Screens ───────────────────────────────────────────────────────────────

    const library       = new XRSongLibrary(sourcedEntries);
    const preScene      = new XRPreScene();
    const activeScene   = new XRActiveScene();
    const settingsScene = new XRSettingsScene();

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
    console.error('[Combined XR] World.create or bootstrap failed:', err);
});
