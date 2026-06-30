import './panel.css';
import './screens/song.css';
import './screens/reposition.css';
import './screens/settings.css';
import './screens/library.css';
import './screens/play.css';

import html2canvas from "html2canvas";
import {
    AssetManifest,
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

import { loadManifest } from "./UIImage.js";
import { FretPlayerScene3D } from "./FretPlayerScene3D.js";
import { KeysPlayerScene3D } from "./KeysPlayerScene3D.js";
import { SongPlayer } from "./SongPlayer.js";
import { CalibrationSystem } from "./CalibrationSystem.js";
import { XRSongLibrary, type SongManifestEntry } from "./XRSongLibrary.js";
import { XRPreScene } from "./XRPreScene.js";
import { XRActiveScene } from "./XRActiveScene.js";
import { XRSettingsScene } from "./XRSettingsScene.js";
import { loadSettings, saveSettings, type Settings } from "./Settings.js";
import { fromHex } from "./UIColor.js";
import type { XrButton } from "./XRTypes.js";
import type { SongStructure, SongKeyboardNotes, SongSection, SongInfo } from "./SongFormat.js";

// ── Asset paths ───────────────────────────────────────────────────────────────

const ATLAS_URL = "/UISheet0.png";

const IMAGE_MANIFEST_URL = "/ImageManifest.json";
const SONG_MANIFEST_URL  = "/songs/manifest.json";

// ── Panel billboard ───────────────────────────────────────────────────────────
let PANEL_BILLBOARD_LOW_OFFSET  = 0.375;  // m below head Y → pitch −30° (tweakable via overlay)
let PANEL_BILLBOARD_HIGH_OFFSET = 0.375;  // m above head Y → pitch +30° (tweakable via overlay)
let PANEL_PITCH_TWEEN_SECS      = 0.5;  // ease-out-expo tween duration (seconds, tweakable)

// ── IWSDK HighwaySystem ───────────────────────────────────────────────────────

class HighwaySystem extends createSystem({}) {
    private raycaster!: Raycaster;
    private rayOrigin!: Vector3;
    private rayDir!: Vector3;

    private lastPanelRender = -999;
    private panelRenderPending = false;
    private panelRenderGen = 0;

    // Scrub state — active while the user holds trigger over the seek bar.
    private scrubBtn: XrButton | null = null;
    private scrubHandIdx = -1; // index into hands[] array; -1 = not scrubbing
    private scrubLastX = 0;

    // Hover state — whichever xrButton the ray is currently over.
    private hoveredBtn: XrButton | null = null;

    private lastCountdownN: number | undefined = undefined;

    // Billboard grab-tracking state.
    private isGrabbed        = false;
    private grabbingHandIdx  = -1;
    private panelPos!: Vector3;
    private headPos!: Vector3;
    private pitchCurrent      = 0;
    private pitchTarget       = 0;
    private pitchAnimProgress = 1;  // 1 = settled, no tween pending
    private pitchAnimFrom     = 0;

    init(): void {
        this.raycaster = new Raycaster();
        this.rayOrigin = new Vector3();
        this.rayDir    = new Vector3();
        this.panelPos  = new Vector3();
        this.headPos   = new Vector3();

        // Called by resizePanel() to discard any in-flight html2canvas render
        // and immediately start a fresh one next frame.
        this.world.globals.invalidatePanelRender = (): void => {
            this.panelRenderGen++;
            this.panelRenderPending = false;
            this.lastPanelRender = -999;
        };
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
            const captureGen = this.panelRenderGen;
            html2canvas(uiPanel, { backgroundColor: null, logging: false }).then(canvas => {
                // Discard if a screen transition invalidated this render.
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
            // Latch grab start: trigger just pressed with ray over the grab bar.
            if (!this.isGrabbed) {
                for (let i = 0; i < hands.length; i++) {
                    const { pad, ray } = hands[i];
                    if (!pad?.getButtonDown(InputComponent.Trigger) || !ray) continue;
                    ray.updateMatrixWorld();
                    ray.getWorldPosition(this.rayOrigin);
                    this.rayDir.set(0, 0, -1).transformDirection(ray.matrixWorld);
                    this.raycaster.set(this.rayOrigin, this.rayDir);
                    // Ray hitting the panel canvas means a button click — don't start a grab.
                    if (panelMesh && this.raycaster.intersectObject(panelMesh).length > 0) continue;
                    if (this.raycaster.intersectObject(grabBarHit).length > 0) {
                        this.isGrabbed       = true;
                        this.grabbingHandIdx = i;
                        (this.input.multiPointers[i === 0 ? 'left' : 'right'] as any).ray.visual.enabled = false;
                        // console.log('[grab-start] grabBar world pos:', ...)
                        break;
                    }
                }
            } else if (this.grabbingHandIdx >= 0) {
                // Release when the grabbing hand lets go of trigger.
                if (hands[this.grabbingHandIdx].pad?.getButtonUp(InputComponent.Trigger)) {
                    (this.input.multiPointers[this.grabbingHandIdx === 0 ? 'left' : 'right'] as any).ray.visual.enabled = true;
                    this.isGrabbed       = false;
                    this.grabbingHandIdx = -1;
                }
            }

            if (this.isGrabbed) {
                // Yaw: rotate panel so its +Z faces the user (instant, no easing).
                grabBarHit.getWorldPosition(this.panelPos);
                this.player.head.getWorldPosition(this.headPos);
                // console.log('[billboard] grabBar LOCAL pos changed this frame:', ...)
                grabBarHit.rotation.y = Math.atan2(
                    this.headPos.x - this.panelPos.x,
                    this.headPos.z - this.panelPos.z,
                );

                // Pitch target relative to head height.
                // panelMesh is 0.169 m above the grab bar root.
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

            // Pitch tween runs to completion even after grab is released.
            if (this.pitchAnimProgress < 1) {
                this.pitchAnimProgress = Math.min(1, this.pitchAnimProgress + delta / PANEL_PITCH_TWEEN_SECS);
                const eased = 1 - Math.pow(2, -10 * this.pitchAnimProgress);
                this.pitchCurrent     = this.pitchAnimFrom + (this.pitchTarget - this.pitchAnimFrom) * eased;
                grabBarHit.rotation.x = this.pitchCurrent;
            }
        }

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

        // ── Per-frame hover scan ──────────────────────────────────────────────
        // Updates .xr-hover class on whichever button the ray is over.
        // No render invalidation needed — the 10fps html2canvas tick picks it up.
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
                break; // first hand that hits the panel wins
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
    world.globals.anchor = anchor;

    // ── Countdown overlay (3D canvas mesh over highway) ───────────────────────
    const countdownCanvas = document.createElement('canvas');
    countdownCanvas.width  = 512;
    countdownCanvas.height = 512;
    const countdownTex  = new CanvasTexture(countdownCanvas);
    const countdownMesh = new Mesh(
        new PlaneGeometry(50, 50), // anchor-local units; 50 × 0.003 = 0.15 m world
        new MeshBasicMaterial({ map: countdownTex, transparent: true }),
    );
    // X=204: center of full 88-key highway (key 21→108 spans ~408 units).
    // Y=200: ~1.4 m world height (eye level above 0.8 m anchor).
    // Z=0: at the now-line.
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

    // Grab bar is the movable root — DistanceGrabbable lets trigger-hold at ray distance move it.
    // Panel canvas is a child so it travels with the bar when grabbed.
    // Panel centre = y 1.3; bar sits 0.169 m below → bar world y = 1.131.
    const grabBarCanvas = document.createElement('canvas');
    grabBarCanvas.width  = 200;
    grabBarCanvas.height = 32;
    const gbCtx = grabBarCanvas.getContext('2d')!;
    const W = grabBarCanvas.width, H = grabBarCanvas.height, gbR = 5;
    gbCtx.fillStyle = 'rgba(255,255,255,0.85)';
    gbCtx.beginPath();                                             // 4 quarter-arcs (not semicircles)
    gbCtx.moveTo(gbR, 0);
    gbCtx.lineTo(W - gbR, 0);
    gbCtx.arc(W - gbR, gbR,     gbR, -Math.PI / 2, 0);           // top-right
    gbCtx.lineTo(W, H - gbR);
    gbCtx.arc(W - gbR, H - gbR, gbR, 0,            Math.PI / 2); // bottom-right
    gbCtx.lineTo(gbR, H);
    gbCtx.arc(gbR,     H - gbR, gbR, Math.PI / 2,  Math.PI);     // bottom-left
    gbCtx.lineTo(0, gbR);
    gbCtx.arc(gbR,     gbR,     gbR, Math.PI,       3 * Math.PI / 2); // top-left
    gbCtx.closePath();
    gbCtx.fill();

    // Invisible hit area — larger plane so the grab bar is easy to raycast.
    // Visual grab bar and panel canvas are children so they move with it.
    const grabBarHit = new Mesh(
        new PlaneGeometry(0.2, 0.04),
        new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    grabBarHit.rotation.order = 'YXZ';  // yaw applied before pitch in local space
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

    // Visible grab bar: centred on the hit area, no RayInteractable (hit area owns that).
    const grabBarVisual = new Mesh(
        new PlaneGeometry(0.08, 0.008),
        new MeshBasicMaterial({ map: new CanvasTexture(grabBarCanvas), transparent: true }),
    );
    world.createTransformEntity(grabBarVisual, {
        parent: grabBarEntity,
        persistent: true,
    });

    // Panel canvas mesh: child of grab bar root, offset +0.169 m up so its centre is at y 1.3.
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

    // Resize the panel mesh, canvas, and DOM element together.
    // Scale factor: 1px = 0.001 m in world space.
    function resizePanel(w: number, h: number): void {
        uiPanel.style.width  = `${w}px`;
        uiPanel.style.height = `${h}px`;
        if (panelCanvas.width !== w || panelCanvas.height !== h) {
            // Setting canvas dimensions clears its contents automatically.
            panelCanvas.width  = w;
            panelCanvas.height = h;
            panelMesh.geometry.dispose();
            panelMesh.geometry = new PlaneGeometry(w * 0.001, h * 0.001);
            // Keep panel centre at ~1.3 m world height relative to the grab bar root.
            // Base offset 0.169 m assumes 300 px height; scale up proportionally.
            panelMesh.position.y = 0.169 + (h - 300) * 0.001 * 0.5;
            // Dispose the WebGL texture so THREE.js must re-upload via texImage2D
            // (not texSubImage2D) at the new canvas dimensions. Without this, the old
            // GPU texture stays at its previous size and the new content only fills
            // a fraction of it, leaving the previous screen visible in the rest.
            panelTex.dispose();
            panelTex.needsUpdate = true;
        }
        // Cancel any in-flight html2canvas render so it can't overwrite the
        // new screen's content with pixels from the previous screen.
        (world.globals.invalidatePanelRender as (() => void) | undefined)?.();
    }

    world.globals.resizePanel = resizePanel;

    // ── App state machine ─────────────────────────────────────────────────────

    // Tracks the current highway scene entity so we can dispose it before loading
    // a new song. Only the ECS entity wrapper is disposed; the scene's GPU resources
    // are released by GC (acceptable for a prototype).
    let highwayEntity: { dispose(): void } | null = null;

    function clearXrButtons(): void {
        for (const btn of xrButtons) btn.el.classList.remove('xr-hover');
        xrButtons.length = 0;
    }

    function showLibrary(): void {
        clearXrButtons();
        resizePanel(1000, 525);
        // Pause any playing song when returning to the library.
        (world.globals.songPlayer as SongPlayer | undefined)?.pause();
        library.show(uiPanel, xrButtons, showPreScene);
    }

    function showPreScene(entry: SongManifestEntry): void {
        clearXrButtons();
        resizePanel(400, 300);
        preScene.show(
            uiPanel,
            xrButtons,
            entry,
            () => (world.globals.tryLoadCalibration as (() => boolean) | undefined)?.() ?? false,
            playEntry,
            calibrateAndPlay,
            repositionEntry,
            showLibrary,
        );
    }

    // Shared song-load logic. Disposes any previous highway, fetches data,
    // creates the scene, and attaches it to the anchor. Returns null if unsupported.
    async function loadSong(
        entry: SongManifestEntry,
        partName: string,
    ): Promise<{ songPlayer: SongPlayer; sections: SongSection[]; totalDuration: number; noteMin: number; noteMax: number } | null> {
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

        const notes   = rawNotes.Notes;
        const noteMin = notes.length > 0
            ? Math.max(21,  Math.min(...notes.map(n => n.Note)) - 1)
            : 21;
        const noteMax = notes.length > 0
            ? Math.min(108, Math.max(...notes.map(n => n.Note)) + 1)
            : 108;

        const scene = new KeysPlayerScene3D(world.renderer, texture, songStructure, rawNotes);

        // Apply saved color/range settings immediately on load.
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

    // Saved calibration path: load song then go straight to active scene.
    async function playEntry(entry: SongManifestEntry, partName: string): Promise<void> {
        clearXrButtons();
        uiPanel.innerHTML = `
            <div style="font-size:18px;padding:24px;text-align:center;
                        color:#e8e8e8;font-family:sans-serif">⏳ Loading…</div>`;

        const result = await loadSong(entry, partName);
        if (!result) { showLibrary(); return; }
        const { songPlayer, sections, totalDuration, noteMin, noteMax } = result;
        showActiveScene(entry, songPlayer, sections, totalDuration, noteMin, noteMax);
    }

    // Reposition path: load song (highway visible), then open fine-tune panel directly.
    async function repositionEntry(entry: SongManifestEntry, partName: string): Promise<void> {
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

    // No saved calibration path: load song first (highway visible), then full 3-step calibrate.
    async function calibrateAndPlay(entry: SongManifestEntry, partName: string): Promise<void> {
        clearXrButtons();
        uiPanel.innerHTML = `
            <div style="font-size:18px;padding:24px;text-align:center;
                        color:#e8e8e8;font-family:sans-serif">⏳ Loading…</div>`;

        const result = await loadSong(entry, partName);
        if (!result) { showLibrary(); return; }
        const { songPlayer, sections, totalDuration, noteMin, noteMax } = result;

        // Highway is now attached to the anchor and rendering — start calibration
        // so the user can see the highway move into alignment as they calibrate.
        (world.globals.startCalibration as ((d: () => void) => void) | undefined)?.(
            () => showActiveScene(entry, songPlayer, sections, totalDuration, noteMin, noteMax),
        );
    }

    function showActiveScene(
        entry: SongManifestEntry,
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
            entry.title,
            entry.artist,
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
        entry: SongManifestEntry,
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
                // Apply the new settings to the live highway scene.
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

    // 3-2-1 countdown with 3s scroll-back animation on resume.
    function resumeWithCountdown(
        pausedAt: number,
        entry: SongManifestEntry,
        songPlayer: SongPlayer,
        sections: SongSection[],
        totalDuration: number,
        noteMin: number,
        noteMax: number,
    ): void {
        const resumeAt = Math.max(0, pausedAt - 3);

        // Pause audio and seek to the rollback position.
        songPlayer.pause();
        songPlayer.seekTo(resumeAt);

        // Drive scene.currentSecond backward via HighwaySystem rollback animation.
        world.globals.rollbackState = { from: pausedAt, to: resumeAt, startMs: performance.now() };

        // Panel stays showing active scene (static); buttons inactive during countdown.
        clearXrButtons();

        // 3D overlay drives the countdown — panel HTML is untouched.
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

    const library       = new XRSongLibrary(songManifest);
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
        // DEBUG — press H to download the current uiPanel HTML for inspection / Figma reference.
        // Remove before shipping.
        if (e.code === "KeyH" && !e.repeat) {
            const clone = uiPanel.cloneNode(true) as HTMLDivElement;
            clone.style.position = 'static';
            clone.style.left = '0';
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#000;display:flex;align-items:flex-start;justify-content:flex-start}</style>
</head><body><!-- DEBUG EXPORT: raw uiPanel outerHTML -->${clone.outerHTML}</body></html>`;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            a.download = 'panel-debug.html';
            a.click();
        }
    });

}).catch((err: unknown) => {
    console.error('[XRProto] World.create or bootstrap failed:', err);
});
