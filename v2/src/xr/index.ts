import './panel.css';
import './screens/song.css';
import './screens/reposition.css';
import './screens/settings.css';
import './screens/library.css';
import './screens/play.css';

import {
    type AssetManifest,
    type Entity,
    AssetType,
    AssetManager,
    CanvasTexture,
    DistanceGrabbable,
    Hovered,
    InputComponent,
    Mesh,
    MeshBasicMaterial,
    MovementMode,
    Object3D,
    PanelDocument,
    PanelUI,
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
import { FretPlayerScene3D } from "../shared/FretPlayerScene3D";
import { SongPlayer } from "../shared/SongPlayer";
import { CalibrationSystem } from "./CalibrationSystem";
import { XRSongLibrary } from "./XRSongLibrary";
import { loadAllSources, type SourcedEntry } from "../shared/SongSource";
import { XRPreScene } from "./XRPreScene";
import { XRActiveScene } from "./XRActiveScene";
import { XRSettingsScene } from "./XRSettingsScene";
import { loadSettings, type Settings } from "../shared/Settings";
import { fromHex } from "../shared/UIColor";
import type {
    SongStructure, SongKeyboardNotes, SongInstrumentNotes, SongSection, SongInfo,
} from "../shared/SongFormat";

// ── In-headset debug console (permanent dev tooling, flagged) ───────────────
// Mirrors console.log/warn/error + uncaught errors onto a canvas plane in the
// scene so they're readable in-headset without chrome://inspect/USB, which
// has proven unreliable. Plain CanvasTexture, not uikit — deliberately
// independent of anything it might be used to debug. See
// ThreeCP/Analysis/UikitLessonsLearned.md and LessonsLearned.md's
// "Debugging JS console from Quest Browser on PC" entry.
const DEBUG_CONSOLE_ENABLED = true;

const debugLines: string[] = [];
const DEBUG_MAX_LINES = 22;
let debugRedraw: (() => void) | null = null;

function pushDebugLine(prefix: string, args: unknown[]): void {
    const text = prefix + args.map(a => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}`;
        try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    for (const line of text.match(/.{1,54}/g) ?? [text]) debugLines.push(line);
    while (debugLines.length > DEBUG_MAX_LINES) debugLines.shift();
    debugRedraw?.();
}

if (DEBUG_CONSOLE_ENABLED) {
    const _origLog   = console.log.bind(console);
    const _origWarn  = console.warn.bind(console);
    const _origError = console.error.bind(console);
    console.log   = (...args: unknown[]) => { _origLog(...args);   pushDebugLine('',    args); };
    console.warn  = (...args: unknown[]) => { _origWarn(...args);  pushDebugLine('[W] ', args); };
    console.error = (...args: unknown[]) => { _origError(...args); pushDebugLine('[E] ', args); };
    window.addEventListener('error', (e) => {
        pushDebugLine('[ERR] ', [e.message, `${e.filename}:${e.lineno}`]);
    });
    window.addEventListener('unhandledrejection', (e) => {
        pushDebugLine('[REJ] ', [String(e.reason)]);
    });
}

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

    private lastCountdownN: number | undefined = undefined;

    private isGrabbed        = false;
    private grabbingHandIdx  = -1;
    private panelPos!: Vector3;
    private headPos!: Vector3;
    private pitchCurrent      = 0;
    private pitchTarget       = 0;
    private pitchAnimProgress = 1;
    private pitchAnimFrom     = 0;

    // Guitar/Bass highway grab bar — position via IWSDK DistanceGrabbable,
    // yaw-only billboard while grabbed (no pitch snap — the volume always
    // stays upright with the ground plane).
    private guitarIsGrabbed       = false;
    private guitarGrabbingHandIdx = -1;
    private guitarBarPos!: Vector3;

    init(): void {
        this.raycaster    = new Raycaster();
        this.rayOrigin    = new Vector3();
        this.rayDir       = new Vector3();
        this.panelPos     = new Vector3();
        this.headPos      = new Vector3();
        this.guitarBarPos = new Vector3();
    }

    update(delta: number, _time: number): void {
        // ── Highway scene — only when a song is loaded ────────────────────────
        const scene = this.world.globals.highwayScene as KeysPlayerScene3D | FretPlayerScene3D | undefined;
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

            // Guitar volume "scrolls": the fret window FretCamera would pan a
            // desktop camera to is instead applied as a content offset, since the
            // HMD owns the real camera in XR. See FretPlayerScene3D.contentOffsetX.
            if (scene instanceof FretPlayerScene3D) {
                const guitarContentNode = this.world.globals.guitarContentNode as Object3D | undefined;
                if (guitarContentNode) guitarContentNode.position.x = scene.contentOffsetX;
            }
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

        // Fires every frame regardless of which panel is currently showing — every
        // uikit panel's live per-frame content (Play HUD's seek/time/icon, etc.)
        // relies on this running unconditionally.
        (this.world.globals.updateActivePanel as (() => void) | undefined)?.();

        // ── Hide hand-tracking visuals while actively playing ───────────────────
        // Lets the player see the fretboard/keyboard without their own hand models
        // in the way. Restored the instant a ray/hand hovers any panel — reusing
        // IWSDK's own Hovered tag (already maintained by InputSystem for every
        // RayInteractable entity as part of its existing ray-cursor hit-testing,
        // so this is a handful of free component lookups, not a new raycast).
        const songPlayer          = this.world.globals.songPlayer          as SongPlayer | undefined;
        const settingsPanelEntity = this.world.globals.settingsPanelEntity as Entity     | undefined;
        const preScenePanelEntity = this.world.globals.preScenePanelEntity as Entity     | undefined;
        const playPanelEntity     = this.world.globals.playPanelEntity     as Entity     | undefined;
        const hoveringPanel =
            !!settingsPanelEntity?.hasComponent(Hovered) ||
            !!preScenePanelEntity?.hasComponent(Hovered) ||
            !!playPanelEntity?.hasComponent(Hovered);

        if (songPlayer?.isPlaying && !hoveringPanel) {
            // Forced every frame, not just once: IWSDK's own InputSystem resets
            // visual.model.visible = isPrimary every frame for connected input
            // sources, unconditionally, so a one-shot false gets silently
            // overwritten the next frame.
            const leftHandVisual  = this.input.visualAdapters.hand.left.visual;
            const rightHandVisual = this.input.visualAdapters.hand.right.visual;
            if (leftHandVisual)  leftHandVisual.model.visible = false;
            if (rightHandVisual) rightHandVisual.model.visible = false;
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

        // ── Guitar highway grab bar: grab + yaw-only billboard (no pitch snap — ──
        // the volume always stays upright with the ground plane) ────────────────
        const guitarGrabBarHit = this.world.globals.guitarGrabBarHit as Mesh | undefined;
        if (guitarGrabBarHit && guitarGrabBarHit.visible) {
            if (!this.guitarIsGrabbed) {
                for (let i = 0; i < hands.length; i++) {
                    const { pad, ray } = hands[i];
                    if (!pad?.getButtonDown(InputComponent.Trigger) || !ray) continue;
                    ray.updateMatrixWorld();
                    ray.getWorldPosition(this.rayOrigin);
                    this.rayDir.set(0, 0, -1).transformDirection(ray.matrixWorld);
                    this.raycaster.set(this.rayOrigin, this.rayDir);
                    if (this.raycaster.intersectObject(guitarGrabBarHit).length > 0) {
                        this.guitarIsGrabbed       = true;
                        this.guitarGrabbingHandIdx = i;
                        (this.input.multiPointers[i === 0 ? 'left' : 'right'] as unknown as { ray: { visual: { enabled: boolean } } }).ray.visual.enabled = false;
                        break;
                    }
                }
            } else if (this.guitarGrabbingHandIdx >= 0) {
                if (hands[this.guitarGrabbingHandIdx].pad?.getButtonUp(InputComponent.Trigger)) {
                    (this.input.multiPointers[this.guitarGrabbingHandIdx === 0 ? 'left' : 'right'] as unknown as { ray: { visual: { enabled: boolean } } }).ray.visual.enabled = true;
                    this.guitarIsGrabbed       = false;
                    this.guitarGrabbingHandIdx = -1;
                }
            }

            if (this.guitarIsGrabbed) {
                guitarGrabBarHit.getWorldPosition(this.guitarBarPos);
                this.player.head.getWorldPosition(this.headPos);
                guitarGrabBarHit.rotation.y = Math.atan2(
                    this.headPos.x - this.guitarBarPos.x,
                    this.headPos.z - this.guitarBarPos.z,
                );
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

    // ── In-headset debug console mesh — fixed world position (not parented to ──
    // the grab bar) so it's always in the same, predictable spot regardless of
    // where the panel has been moved. See pushDebugLine() above.
    if (DEBUG_CONSOLE_ENABLED) {
        const debugCanvas = document.createElement('canvas');
        debugCanvas.width  = 640;
        debugCanvas.height = 480;
        const debugCtx = debugCanvas.getContext('2d')!;
        const debugTex = new CanvasTexture(debugCanvas);
        const debugMesh = new Mesh(
            new PlaneGeometry(0.5, 0.375),
            new MeshBasicMaterial({ map: debugTex, transparent: true }),
        );
        debugMesh.position.set(0.25, 1.55, -0.6);
        world.createTransformEntity(debugMesh, { parent: world.sceneEntity, persistent: true });
        debugRedraw = () => {
            debugCtx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            debugCtx.fillRect(0, 0, debugCanvas.width, debugCanvas.height);
            debugCtx.font = '16px monospace';
            debugCtx.fillStyle = '#00ff66';
            debugCtx.textBaseline = 'top';
            debugLines.forEach((line, i) => debugCtx.fillText(line, 6, 6 + i * 20));
            debugTex.needsUpdate = true;
        };
        debugRedraw();
    }

    // ── Countdown overlay (Keys) ──────────────────────────────────────────────
    // world.globals.countdown{Mesh,Canvas,Tex} are generic — HighwaySystem just
    // draws into whichever the active loadSong() branch points them at. Guitar's
    // own countdown mesh is created below, once guitarGrabBarEntity exists.
    const keysCountdownCanvas = document.createElement('canvas');
    keysCountdownCanvas.width  = 512;
    keysCountdownCanvas.height = 512;
    const keysCountdownTex  = new CanvasTexture(keysCountdownCanvas);
    const keysCountdownMesh = new Mesh(
        new PlaneGeometry(50, 50),
        new MeshBasicMaterial({ map: keysCountdownTex, transparent: true }),
    );
    keysCountdownMesh.position.set(204, 125, -100);
    keysCountdownMesh.visible = false;
    world.createTransformEntity(keysCountdownMesh, { parent: anchorEntity, persistent: true });

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

    // ── Settings uikit panel (Phase B of the html2canvas → uikit migration) ─────
    // Same slot every uikit panel below shares (child of grabBarEntity), each
    // toggled visible while its own screen is showing — see
    // showSettings()/showActiveScene() below. Created once, persistent; content
    // is static (see ui/settings.uikitml) and wired/updated via setProperties()
    // rather than recreated per-open.
    const settingsPanelObj = new Object3D();
    settingsPanelObj.position.set(0, 0.169, 0);
    settingsPanelObj.visible = false;
    // pointer-events also starts at 'none' by default in ui/settings.uikitml
    // itself — visible=false alone doesn't reliably stop uikit's own
    // click/hover dispatch from hitting this panel while it's meant to be
    // hidden (confirmed via testing), so interactivity is gated separately.
    const settingsPanelEntity = world.createTransformEntity(settingsPanelObj, {
        parent: grabBarEntity,
        persistent: true,
    });
    // RayInteractable is NOT added here — it starts absent (panel starts
    // hidden) and gets added/removed by setSettingsPanelInteractive() below,
    // so the panel is fully excluded from IWSDK's rayDescendants list (the
    // ray-cursor targets) while hidden, not just visually hidden.
    settingsPanelEntity.addComponent(PanelUI, {
        config: '/ui/settings.json',
        maxWidth: 0.4,
        maxHeight: 0.3,
    });
    world.globals.settingsPanelObj    = settingsPanelObj;
    world.globals.settingsPanelEntity = settingsPanelEntity;

    // Two separate gates, both needed (confirmed via testing — pointerEvents
    // alone still let the ray cursor snap to/stop at the hidden panel):
    // - RayInteractable add/remove: excludes the panel from IWSDK's
    //   InputSystem raycast-target list entirely, so the ray cursor passes
    //   through to whatever's actually behind it instead of stopping here.
    // - pointerEvents: gates uikit's own internal click/hover dispatch,
    //   independent of the above.
    function setSettingsPanelInteractive(enabled: boolean): void {
        if (enabled) {
            if (!settingsPanelEntity.hasComponent(RayInteractable)) {
                settingsPanelEntity.addComponent(RayInteractable);
            }
        } else {
            if (settingsPanelEntity.hasComponent(RayInteractable)) {
                settingsPanelEntity.removeComponent(RayInteractable);
            }
        }
        const doc = settingsPanelEntity.getValue(PanelDocument, 'document') as
            { rootElement: { setProperties: (p: Record<string, unknown>) => void } } | null;
        doc?.rootElement.setProperties({ pointerEvents: enabled ? 'auto' : 'none' });
    }
    setSettingsPanelInteractive(false);

    // ── Song/PreScene uikit panel (next screen-by-screen migration step after
    // Settings) ───────────────────────────────────────────────────────────────
    // Same slot/pattern as settingsPanelObj above — dedicated, always-mounted
    // entity per screen (decided over a shared/swappable single entity; see the
    // migration plan notes) rather than something novel.
    const preScenePanelObj = new Object3D();
    preScenePanelObj.position.set(0, 0.169, 0);
    preScenePanelObj.visible = false;
    const preScenePanelEntity = world.createTransformEntity(preScenePanelObj, {
        parent: grabBarEntity,
        persistent: true,
    });
    preScenePanelEntity.addComponent(PanelUI, {
        config: '/ui/song.json',
        maxWidth: 0.4,
        maxHeight: 0.3,
    });
    world.globals.preScenePanelObj    = preScenePanelObj;
    world.globals.preScenePanelEntity = preScenePanelEntity;

    function setPreScenePanelInteractive(enabled: boolean): void {
        if (enabled) {
            if (!preScenePanelEntity.hasComponent(RayInteractable)) {
                preScenePanelEntity.addComponent(RayInteractable);
            }
        } else {
            if (preScenePanelEntity.hasComponent(RayInteractable)) {
                preScenePanelEntity.removeComponent(RayInteractable);
            }
        }
        const doc = preScenePanelEntity.getValue(PanelDocument, 'document') as
            { rootElement: { setProperties: (p: Record<string, unknown>) => void } } | null;
        doc?.rootElement.setProperties({ pointerEvents: enabled ? 'auto' : 'none' });
    }
    setPreScenePanelInteractive(false);

    // ── Play HUD uikit panel (third screen-by-screen migration step) ────────────
    // Same slot/pattern as settingsPanelObj/preScenePanelObj above.
    const playPanelObj = new Object3D();
    playPanelObj.position.set(0, 0.169, 0);
    playPanelObj.visible = false;
    const playPanelEntity = world.createTransformEntity(playPanelObj, {
        parent: grabBarEntity,
        persistent: true,
    });
    playPanelEntity.addComponent(PanelUI, {
        config: '/ui/play.json',
        maxWidth: 0.4,
        maxHeight: 0.3,
    });
    world.globals.playPanelObj    = playPanelObj;
    world.globals.playPanelEntity = playPanelEntity;

    function setPlayPanelInteractive(enabled: boolean): void {
        if (enabled) {
            if (!playPanelEntity.hasComponent(RayInteractable)) {
                playPanelEntity.addComponent(RayInteractable);
            }
        } else {
            if (playPanelEntity.hasComponent(RayInteractable)) {
                playPanelEntity.removeComponent(RayInteractable);
            }
        }
        const doc = playPanelEntity.getValue(PanelDocument, 'document') as
            { rootElement: { setProperties: (p: Record<string, unknown>) => void } } | null;
        doc?.rootElement.setProperties({ pointerEvents: enabled ? 'auto' : 'none' });
    }
    setPlayPanelInteractive(false);

    // ── Library uikit panel (fourth screen-by-screen migration step off
    // html2canvas) ───────────────────────────────────────────────────────────
    // Same slot/pattern as settingsPanelObj/preScenePanelObj/playPanelObj
    // above, but a different physical size (1m x 0.525m, not the standard
    // 0.4m x 0.3m the other panels use), since the 3-column song grid needs
    // more room than the other screens.
    //
    // Y offset is NOT the same 0.169 the other panels use — those are
    // centered on their own local origin at a height tuned so a 0.3m-tall
    // panel's BOTTOM edge sits 0.019m above the grab bar (0.169 - 0.3/2).
    // Keeping that same center
    // offset for this taller 0.525m panel would push its bottom edge to
    // 0.169 - 0.525/2 = -0.0935m — i.e. below the bar, overlapping it.
    // Solved for the center offset that preserves the same 0.019m bottom-edge
    // gap instead: 0.019 + 0.525/2 = 0.2815.
    const libraryPanelObj = new Object3D();
    libraryPanelObj.position.set(0, 0.2815, 0);
    libraryPanelObj.visible = false;
    const libraryPanelEntity = world.createTransformEntity(libraryPanelObj, {
        parent: grabBarEntity,
        persistent: true,
    });
    libraryPanelEntity.addComponent(PanelUI, {
        config: '/ui/library.json',
        maxWidth: 1.0,
        maxHeight: 0.525,
    });
    world.globals.libraryPanelObj    = libraryPanelObj;
    world.globals.libraryPanelEntity = libraryPanelEntity;

    function setLibraryPanelInteractive(enabled: boolean): void {
        if (enabled) {
            if (!libraryPanelEntity.hasComponent(RayInteractable)) {
                libraryPanelEntity.addComponent(RayInteractable);
            }
        } else {
            if (libraryPanelEntity.hasComponent(RayInteractable)) {
                libraryPanelEntity.removeComponent(RayInteractable);
            }
        }
        const doc = libraryPanelEntity.getValue(PanelDocument, 'document') as
            { rootElement: { setProperties: (p: Record<string, unknown>) => void } } | null;
        doc?.rootElement.setProperties({ pointerEvents: enabled ? 'auto' : 'none' });
    }
    setLibraryPanelInteractive(false);

    // ── Calibration/fine-tune-reposition uikit panel (last screen-by-screen
    // migration step off html2canvas) ────────────────────────────────────────
    // Same slot/pattern as settingsPanelObj/preScenePanelObj/playPanelObj —
    // standard 0.4m x 0.3m size, so the standard 0.169 center offset applies
    // unchanged (no Library-style bottom-edge recompute needed).
    //
    // CalibrationSystem is a separately-registered ECS system (createSystem),
    // not a plain class index.ts instantiates directly like
    // XRSettingsScene/XRSongLibrary — so it can't receive this entity via a
    // show() call argument. It reads calibrationPanelEntity and calls
    // setCalibrationPanelInteractive via world.globals instead, same
    // directional-callback convention already used for setGuitarHighwayScale
    // (index.ts owns and exposes the function; other files call it).
    const calibrationPanelObj = new Object3D();
    calibrationPanelObj.position.set(0, 0.169, 0);
    calibrationPanelObj.visible = false;
    const calibrationPanelEntity = world.createTransformEntity(calibrationPanelObj, {
        parent: grabBarEntity,
        persistent: true,
    });
    calibrationPanelEntity.addComponent(PanelUI, {
        config: '/ui/calibration.json',
        maxWidth: 0.4,
        maxHeight: 0.3,
    });
    world.globals.calibrationPanelObj    = calibrationPanelObj;
    world.globals.calibrationPanelEntity = calibrationPanelEntity;

    function setCalibrationPanelInteractive(enabled: boolean): void {
        if (enabled) {
            if (!calibrationPanelEntity.hasComponent(RayInteractable)) {
                calibrationPanelEntity.addComponent(RayInteractable);
            }
        } else {
            if (calibrationPanelEntity.hasComponent(RayInteractable)) {
                calibrationPanelEntity.removeComponent(RayInteractable);
            }
        }
        const doc = calibrationPanelEntity.getValue(PanelDocument, 'document') as
            { rootElement: { setProperties: (p: Record<string, unknown>) => void } } | null;
        doc?.rootElement.setProperties({ pointerEvents: enabled ? 'auto' : 'none' });
    }
    setCalibrationPanelInteractive(false);
    world.globals.setCalibrationPanelInteractive = setCalibrationPanelInteractive;

    // ── Guitar/Bass highway grab bar + content-scroll node ──────────────────────
    // Sits "beneath" the fret volume. Grabbing it repositions the whole volume
    // (position handled by IWSDK DistanceGrabbable; yaw billboard is custom, see
    // HighwaySystem.update()). guitarContentNode is the scroll node that
    // FretPlayerScene3D's positionFret offsets each frame — see FretPlayerScene3D.

    const guitarGrabBarHit = new Mesh(
        new PlaneGeometry(0.2, 0.04),
        new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    guitarGrabBarHit.rotation.order = 'YXZ';
    guitarGrabBarHit.visible = false;
    const guitarGrabBarEntity = world.createTransformEntity(guitarGrabBarHit, {
        parent: world.sceneEntity,
        persistent: true,
    });
    guitarGrabBarEntity.addComponent(RayInteractable);
    guitarGrabBarEntity.addComponent(DistanceGrabbable, {
        rotate: false,
        scale:  false,
        movementMode: MovementMode.MoveAtSource,
    });

    const guitarGrabBarVisual = new Mesh(
        new PlaneGeometry(0.08, 0.008),
        new MeshBasicMaterial({ map: new CanvasTexture(grabBarCanvas), transparent: true }),
    );
    world.createTransformEntity(guitarGrabBarVisual, {
        parent: guitarGrabBarEntity,
        persistent: true,
    });

    // Fixed real-world gap so the highway sits above the bar rather than around
    // it — same role as every panel's own 0.169 position.y offset. Position is set
    // by CalibrationSystem.applyGuitarHighwayScale() once calibration runs
    // (compensates for Settings.guitarHighwayScale so the gap stays constant
    // regardless of highway size — see that method for the math).
    const guitarContentOffsetNode = new Object3D();
    const guitarContentOffsetEntity = world.createTransformEntity(guitarContentOffsetNode, {
        parent: guitarGrabBarEntity,
        persistent: true,
    });

    // Carries the calibrated content scale (real-world meters per fret-position
    // unit) — kept separate from guitarGrabBarHit so the handle itself (and its
    // visual pill) always stays the same physical size, regardless of scale.
    const guitarScaleNode = new Object3D();
    const guitarScaleEntity = world.createTransformEntity(guitarScaleNode, {
        parent: guitarContentOffsetEntity,
        persistent: true,
    });

    const guitarContentNode = new Object3D();
    const guitarContentEntity = world.createTransformEntity(guitarContentNode, {
        parent: guitarScaleEntity,
        persistent: true,
    });

    // ── Countdown overlay (Guitar) ──────────────────────────────────────────
    // Parented directly to the bar (unscaled — real-world meters), so it
    // inherits the volume's calibrated position/yaw automatically ("shares its
    // pose") without any extra per-frame sync code.
    const guitarCountdownCanvas = document.createElement('canvas');
    guitarCountdownCanvas.width  = 512;
    guitarCountdownCanvas.height = 512;
    const guitarCountdownTex  = new CanvasTexture(guitarCountdownCanvas);
    const guitarCountdownMesh = new Mesh(
        new PlaneGeometry(0.15, 0.15),
        new MeshBasicMaterial({ map: guitarCountdownTex, transparent: true }),
    );
    guitarCountdownMesh.position.set(0, 0.18, 0); // a bit above the highway's ~0.1m top edge
    guitarCountdownMesh.visible = false;
    world.createTransformEntity(guitarCountdownMesh, { parent: guitarGrabBarEntity, persistent: true });

    world.globals.grabBarHit              = grabBarHit;
    world.globals.guitarGrabBarHit        = guitarGrabBarHit;
    world.globals.guitarScaleNode         = guitarScaleNode;
    world.globals.guitarContentOffsetNode = guitarContentOffsetNode;
    world.globals.guitarContentNode       = guitarContentNode;

    // ── App state machine ─────────────────────────────────────────────────────

    let highwayEntity: { dispose(): void } | null = null;

    // Disposes the mounted highway mesh and hides whichever grab bar owns it.
    // guitarGrabBarHit's own visual pill is a persistent sibling, not part of
    // highwayEntity, so disposing the mesh alone would leave it floating visible.
    function disposeHighway(): void {
        if (highwayEntity) {
            highwayEntity.dispose();
            highwayEntity = null;
        }
        world.globals.highwayScene = undefined;
        world.globals.songPlayer   = undefined;
        guitarGrabBarHit.visible   = false;
    }

    function showLibrary(): void {
        libraryPanelObj.visible = true;
        setLibraryPanelInteractive(true);
        preScenePanelObj.visible = false;
        setPreScenePanelInteractive(false);
        playPanelObj.visible     = false;
        setPlayPanelInteractive(false);
        calibrationPanelObj.visible = false;
        setCalibrationPanelInteractive(false);
        (world.globals.songPlayer as SongPlayer | undefined)?.pause();
        disposeHighway();
        library.show(libraryPanelEntity, showPreScene);
    }

    function showPreScene(sourced: SourcedEntry): void {
        libraryPanelObj.visible = false;
        setLibraryPanelInteractive(false);
        calibrationPanelObj.visible = false;
        setCalibrationPanelInteractive(false);
        preScenePanelObj.visible = true;
        setPreScenePanelInteractive(true);
        preScene.show(
            preScenePanelEntity,
            sourced,
            (instrumentType: string) =>
                (world.globals.tryLoadCalibration as ((t: string) => boolean) | undefined)?.(instrumentType) ?? false,
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
        disposeHighway();

        const { source, entry } = sourced;
        const part = entry.parts.find(p => p.name === partName);
        if (!part) return null;

        world.globals.currentPartType = part.type;

        const songPlayer = new SongPlayer();
        const saved = loadSettings();

        if (part.type === 'Keys') {
            guitarGrabBarHit.visible = false;
            guitarCountdownMesh.visible = false;
            world.globals.countdownMesh   = keysCountdownMesh;
            world.globals.countdownCanvas = keysCountdownCanvas;
            world.globals.countdownTex    = keysCountdownTex;

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

        // ── Guitar / Bass ────────────────────────────────────────────────────────
        keysCountdownMesh.visible = false;
        world.globals.countdownMesh   = guitarCountdownMesh;
        world.globals.countdownCanvas = guitarCountdownCanvas;
        world.globals.countdownTex    = guitarCountdownTex;

        const [songStructure, instrumentNotes, songInfo] = await Promise.all([
            fetchJson<SongStructure>(source.getFileUrl(entry, 'arrangement.json')),
            fetchJson<SongInstrumentNotes>(source.getFileUrl(entry, `${partName}.json`)),
            fetchJson<SongInfo>(source.getFileUrl(entry, 'song.json')),
            songPlayer.loadSong(source.getFileUrl(entry, 'song.ogg')).catch(() => {}),
        ]) as [SongStructure, SongInstrumentNotes, SongInfo, void];

        const instrumentPart =
            songInfo.InstrumentParts.find(p => p.InstrumentName === part.name) ??
            songInfo.InstrumentParts[0];

        const scene = new FretPlayerScene3D(
            world.renderer, texture, songStructure, instrumentNotes, instrumentPart,
        );
        scene.boldText           = saved.boldText;
        scene.invertStrings      = saved.invertStrings;
        scene.leftyMode          = saved.leftyMode;
        scene.noteNumbersDesktop = saved.noteNumbersDesktop;
        scene.noteNumbersXR      = saved.noteNumbersXR;

        const firstNoteTime = instrumentNotes.Notes[0]?.TimeOffset ?? 0;
        if (firstNoteTime > 0) songPlayer.seekTo(firstNoteTime);
        scene.currentSecond = songPlayer.currentSecond;

        highwayEntity = world.createTransformEntity(scene.mesh, {
            parent: guitarContentEntity,
            persistent: true,
        });
        world.globals.highwayScene = scene;
        world.globals.songPlayer   = songPlayer;

        // Placement is instant/synchronous (unlike Keys' multi-step pointing
        // flow), so there's no in-between state to hide — show it as soon as
        // it's mounted, regardless of which caller runs next (direct Play,
        // Reposition, or first-time calibrate).
        guitarGrabBarHit.visible = true;

        const totalDuration = songPlayer.duration > 0
            ? songPlayer.duration
            : (songInfo.SongLengthSeconds ?? 0);

        const sections = instrumentNotes.Sections?.length > 0
            ? instrumentNotes.Sections
            : (songStructure.Sections ?? []);

        return { songPlayer, sections, totalDuration, noteMin: 21, noteMax: 108 };
    }

    async function playEntry(entry: SourcedEntry, partName: string): Promise<void> {
        const result = await loadSong(entry, partName);
        if (!result) { showLibrary(); return; }
        const { songPlayer, sections, totalDuration, noteMin, noteMax } = result;
        showActiveScene(entry, songPlayer, sections, totalDuration, noteMin, noteMax);
    }

    async function repositionEntry(entry: SourcedEntry, partName: string): Promise<void> {
        const result = await loadSong(entry, partName);
        if (!result) { showLibrary(); return; }
        const { songPlayer, sections, totalDuration, noteMin, noteMax } = result;

        // Reached from PreScene — preScenePanelObj is still visible at this
        // point (showPreScene() set it). CalibrationSystem's panel occupies
        // the exact same grabBarEntity-relative slot as every other panel, so
        // leaving PreScene's panel visible alongside it causes z-fighting.
        preScenePanelObj.visible = false;
        setPreScenePanelInteractive(false);
        (world.globals.showCalibrationFineTune as ((d: () => void) => void) | undefined)?.(
            () => showActiveScene(entry, songPlayer, sections, totalDuration, noteMin, noteMax),
        );
    }

    async function calibrateAndPlay(entry: SourcedEntry, partName: string): Promise<void> {
        const result = await loadSong(entry, partName);
        if (!result) { showLibrary(); return; }
        const { songPlayer, sections, totalDuration, noteMin, noteMax } = result;

        // Same reasoning as repositionEntry() above — also reached from
        // PreScene, first-time calibration.
        preScenePanelObj.visible = false;
        setPreScenePanelInteractive(false);
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
        libraryPanelObj.visible  = false;
        setLibraryPanelInteractive(false);
        settingsPanelObj.visible = false;
        setSettingsPanelInteractive(false);
        preScenePanelObj.visible = false;
        setPreScenePanelInteractive(false);
        calibrationPanelObj.visible = false;
        setCalibrationPanelInteractive(false);
        playPanelObj.visible     = true;
        setPlayPanelInteractive(true);
        world.globals.updateActivePanel = undefined;
        activeScene.show(
            playPanelEntity,
            entry.entry.songName,
            entry.entry.artistName,
            entry.source.getAlbumArtUrl(entry.entry),
            songPlayer,
            totalDuration,
            sections,
            (done: () => void) => {
                // Do NOT hide playPanelObj here. Guitar's recalibrate is
                // instant/no-panel (see CalibrationSystem.ts) — `done` here is
                // just XRActiveScene's own rerender(), not a full
                // showActiveScene() re-run, so hiding this panel would leave
                // it permanently invisible (nothing else would ever set it
                // visible again for that path). Keys DOES show its own panel
                // over this same slot — CalibrationSystem._showPanel() is
                // responsible for hiding this one first when that happens,
                // since only it knows whether a panel is actually about to
                // show.
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
        libraryPanelObj.visible  = false;
        setLibraryPanelInteractive(false);
        settingsPanelObj.visible = true;
        setSettingsPanelInteractive(true);
        playPanelObj.visible     = false;
        setPlayPanelInteractive(false);
        calibrationPanelObj.visible = false;
        setCalibrationPanelInteractive(false);
        world.globals.updateActivePanel = undefined;
        settingsScene.show(
            settingsPanelEntity,
            noteMin,
            noteMax,
            world.globals.highwayScene instanceof FretPlayerScene3D,
            (s: Settings) => {
                const scene = world.globals.highwayScene;
                if (scene instanceof KeysPlayerScene3D) {
                    scene.minKey = s.fullKeyboard ? 21 : noteMin;
                    scene.maxKey = s.fullKeyboard ? 108 : noteMax;
                    scene.syncHighwayBounds();
                    scene.rightHandColor = fromHex(s.keysRightHandColor);
                    scene.leftHandColor  = fromHex(s.keysLeftHandColor);
                } else if (scene instanceof FretPlayerScene3D) {
                    scene.boldText           = s.boldText;
                    scene.invertStrings      = s.invertStrings;
                    scene.leftyMode          = s.leftyMode;
                    scene.noteNumbersDesktop = s.noteNumbersDesktop;
                    scene.noteNumbersXR      = s.noteNumbersXR;
                    (world.globals.setGuitarHighwayScale as ((m: number) => void) | undefined)?.(s.guitarHighwayScale);
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
    console.error('[v2 XR] World.create or bootstrap failed:', err);
});
