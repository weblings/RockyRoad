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
    VisibilityState,
    World,
    createSystem,
} from "@iwsdk/core";

import { loadManifest } from "./UIImage.js";
import { FretPlayerScene3D } from "./FretPlayerScene3D.js";
import { KeysPlayerScene3D } from "./KeysPlayerScene3D.js";
import { SongPlayer } from "./SongPlayer.js";
import { CalibrationSystem } from "./CalibrationSystem.js";
import type { SongInfo, SongStructure, SongInstrumentNotes, SongKeyboardNotes } from "./SongFormat.js";

// ── Hardcoded asset paths (Phase 1 prototype) ────────────────────────────────

const ATLAS_URL =
    "/@fs/D:/Users/Andrew/Documents/Coding/MusicThing/ChartPlayer/ChartPlayerShared/Content/Textures/UISheet0.png";

const MANIFEST_URL = "/ImageManifest.json";

const SONG_BASE = "/songs/fur-elise";

// ── Types ─────────────────────────────────────────────────────────────────────

interface XrButton { el: HTMLButtonElement; onClick: () => void; }

// ── IWSDK HighwaySystem ───────────────────────────────────────────────────────

class HighwaySystem extends createSystem({}) {
    // Pre-allocated scratch objects — no allocations in update().
    private raycaster!: Raycaster;
    private rayOrigin!: Vector3;
    private rayDir!: Vector3;

    // Panel render throttle state.
    private lastPanelRender = -999;
    private panelRenderPending = false;

    init(): void {
        this.raycaster = new Raycaster();
        this.rayOrigin = new Vector3();
        this.rayDir = new Vector3();
    }

    update(delta: number, time: number): void {
        const scene = this.world.globals.highwayScene as FretPlayerScene3D | KeysPlayerScene3D | undefined;
        if (!scene) return;

        // Drive currentSecond from audio player.
        const songPlayer = this.world.globals.songPlayer as SongPlayer | undefined;
        if (songPlayer) {
            scene.currentSecond = songPlayer.currentSecond;
        } else {
            scene.currentSecond += delta;
        }

        scene.draw(delta);

        // Desktop only: map scene camera through the anchor's world matrix.
        if (this.world.visibilityState.peek() !== VisibilityState.Visible) {
            const anchor = this.world.globals.anchor as Object3D | undefined;
            if (anchor) {
                anchor.updateMatrixWorld();
                scene.syncCameraTo(this.world.camera as any, anchor as any);
            }
        }

        // ── Panel: throttled html2canvas render (~10 fps) ─────────────────────
        const uiPanel   = this.world.globals.uiPanel   as HTMLDivElement  | undefined;
        const panelMesh = this.world.globals.panelMesh as Mesh            | undefined;
        const panelTex  = this.world.globals.panelTex  as CanvasTexture   | undefined;
        const xrButtons = this.world.globals.xrButtons as XrButton[]      | undefined;

        if (uiPanel && panelTex && !this.panelRenderPending
                && time - this.lastPanelRender > 0.1) {
            this.panelRenderPending = true;
            this.lastPanelRender = time;
            html2canvas(uiPanel, { backgroundColor: null, logging: false }).then(canvas => {
                const dst = panelTex.image as HTMLCanvasElement;
                dst.getContext("2d")!.drawImage(canvas, 0, 0, dst.width, dst.height);
                panelTex.needsUpdate = true;
                this.panelRenderPending = false;
            }).catch(() => { this.panelRenderPending = false; });
        }

        // Either trigger: hit-test panel and fire the button under the ray.
        const hands = [
            { pad: this.input.gamepads.left,  ray: this.player.raySpaces.left },
            { pad: this.input.gamepads.right, ray: this.player.raySpaces.right },
        ] as const;
        for (const { pad, ray } of hands) {
            if (!pad?.getButtonDown(InputComponent.Trigger)) continue;
            if (!panelMesh || !uiPanel || !xrButtons || !ray) continue;

            ray.updateMatrixWorld();
            panelMesh.updateMatrixWorld();

            ray.getWorldPosition(this.rayOrigin);
            this.rayDir.set(0, 0, -1).transformDirection(ray.matrixWorld);
            this.raycaster.set(this.rayOrigin, this.rayDir);

            const hits = this.raycaster.intersectObject(panelMesh);
            if (hits.length === 0 || !hits[0].uv) continue;

            const uv = hits[0].uv;
            const panelRect = uiPanel.getBoundingClientRect();
            const pixX = uv.x * panelRect.width;
            const pixY = (1 - uv.y) * panelRect.height;

            for (const { el, onClick } of xrButtons) {
                const r = el.getBoundingClientRect();
                const bx = r.left - panelRect.left;
                const by = r.top  - panelRect.top;
                if (pixX >= bx && pixX <= bx + r.width
                        && pixY >= by && pixY <= by + r.height) {
                    onClick();
                    break;
                }
            }
        }
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const assets: AssetManifest = {
    atlas: {
        url: ATLAS_URL,
        type: AssetType.Texture,
        priority: "critical",
    },
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
    const texture = AssetManager.getTexture("atlas")!;

    const songPlayer = new SongPlayer();

    // Stage 1: load song manifest, image manifest, and audio in parallel.
    // Notes filename depends on the instrument part name, so song.json must load first.
    // Audio load is optional — if song.ogg is absent, the scene still renders without sound.
    const fetchJson = (url: string) =>
        fetch(url).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
            const ct = r.headers.get('content-type') ?? '';
            if (!ct.includes('json')) throw new Error(`Expected JSON, got ${ct} from ${url}`);
            return r.json();
        });

    const [songInfo] = await Promise.all([
        fetchJson(`${SONG_BASE}/song.json`) as Promise<SongInfo>,
        loadManifest(MANIFEST_URL),
        songPlayer.loadSong(`${SONG_BASE}/song.ogg`).catch(() => {}),
    ]) as [SongInfo, void, void];

    const part = songInfo.InstrumentParts[0];

    // Stage 2: load structure and instrument-specific notes in parallel.
    const [songStructure, rawNotes] = await Promise.all([
        fetchJson(`${SONG_BASE}/arrangement.json`) as Promise<SongStructure>,
        fetchJson(`${SONG_BASE}/${part.InstrumentName}.json`),
    ]);

    // Instantiate the correct scene for the instrument type — mirrors ActiveSceneScreen.
    let highwayScene: FretPlayerScene3D | KeysPlayerScene3D;
    let firstNoteTime: number;

    if (part.InstrumentType === 'Keys') {
        const keyboardNotes = rawNotes as SongKeyboardNotes;
        highwayScene = new KeysPlayerScene3D(world.renderer, texture, songStructure, keyboardNotes);
        firstNoteTime = keyboardNotes.Notes[0]?.TimeOffset ?? 0;
    } else {
        const instrumentNotes = rawNotes as SongInstrumentNotes;
        highwayScene = new FretPlayerScene3D(world.renderer, texture, songStructure, instrumentNotes, part);
        firstNoteTime = instrumentNotes.Notes[0]?.TimeOffset ?? 0;
    }

    if (firstNoteTime > 0) {
        songPlayer.seekTo(firstNoteTime);
    }
    highwayScene.currentSecond = songPlayer.currentSecond;

    // ── Highway anchor ────────────────────────────────────────────────────────
    const anchor = new Object3D();
    anchor.scale.setScalar(0.003);
    anchor.position.set(-0.45, 0.8, -0.5);
    const anchorEntity = world.createTransformEntity(anchor, {
        parent: world.sceneEntity,
        persistent: true,
    });
    world.globals.anchor = anchor;

    anchorEntity.addComponent(RayInteractable);
    anchorEntity.addComponent(OneHandGrabbable, {});

    world.createTransformEntity(highwayScene.mesh, {
        parent: anchorEntity,
        persistent: true,
    });

    // ── UI Panel (Phase 6) ────────────────────────────────────────────────────
    // DOM div is off-screen but still laid out so getBoundingClientRect() works.
    const uiPanel = document.createElement("div");
    uiPanel.style.cssText = [
        "position:fixed",
        "left:-9999px",
        "top:0",
        "width:400px",
        "height:300px",
        "background:#1a1a2e",
        "color:#e8e8e8",
        "font-family:sans-serif",
        "padding:20px",
        "box-sizing:border-box",
        "border-radius:8px",
    ].join(";");
    uiPanel.innerHTML = `
        <div style="font-size:20px;font-weight:bold;margin-bottom:20px">
            ${(songInfo as any).Title ?? "ChartPlayer XR"}
        </div>
        <button id="xr-btn-play" style="display:block;width:100%;margin-bottom:12px;
            padding:14px;background:#3a3a7a;color:#e8e8e8;border:none;border-radius:6px;
            font-size:16px;cursor:pointer">
            ▶ Play / Pause
        </button>
        <button id="xr-btn-exit" style="display:block;width:100%;
            padding:14px;background:#7a3a3a;color:#e8e8e8;border:none;border-radius:6px;
            font-size:16px;cursor:pointer">
            ✕ Exit XR
        </button>
    `;
    document.body.appendChild(uiPanel);

    const xrButtons: XrButton[] = [
        {
            el: uiPanel.querySelector("#xr-btn-play") as HTMLButtonElement,
            onClick: () => { if (songPlayer.isPlaying) songPlayer.pause(); else songPlayer.play(); },
        },
        {
            el: uiPanel.querySelector("#xr-btn-exit") as HTMLButtonElement,
            onClick: () => world.exitXR(),
        },
    ];

    // 400×300 canvas backs the CanvasTexture.
    const panelCanvas = document.createElement("canvas");
    panelCanvas.width = 400;
    panelCanvas.height = 300;
    const panelTex = new CanvasTexture(panelCanvas);

    const panelMesh = new Mesh(
        new PlaneGeometry(0.4, 0.3),
        new MeshBasicMaterial({ map: panelTex, transparent: true }),
    );
    // Position: to the right of and slightly above the highway anchor.
    panelMesh.position.set(0.25, 1.3, -0.6);

    const panelEntity = world.createTransformEntity(panelMesh, {
        parent: world.sceneEntity,
        persistent: true,
    });
    panelEntity.addComponent(RayInteractable);

    world.globals.highwayScene = highwayScene;
    world.globals.songPlayer = songPlayer;
    world.globals.uiPanel    = uiPanel;
    world.globals.panelMesh  = panelMesh;
    world.globals.panelTex   = panelTex;
    world.globals.xrButtons  = xrButtons;

    world.registerSystem(CalibrationSystem);
    world.registerSystem(HighwaySystem);

    // Desktop: Space bar toggles play/pause. V launches XR (no IWER button in device mode).
    document.addEventListener("keydown", (e) => {
        if (e.code === "Space" && !e.repeat) {
            e.preventDefault();
            if (songPlayer.isPlaying) songPlayer.pause();
            else songPlayer.play();
        }
        if (e.code === "KeyV" && !e.repeat) {
            world.launchXR();
        }
    });

}).catch((err: unknown) => {
    console.error('[XRProto] World.create or bootstrap failed:', err);
});
