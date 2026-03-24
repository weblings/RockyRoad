import {
    AssetManifest,
    AssetType,
    AssetManager,
    SessionMode,
    World,
    createSystem,
} from "@iwsdk/core";

import { loadManifest } from "./UIImage.js";
import { FretPlayerScene3D } from "./FretPlayerScene3D.js";
import type { SongInfo, SongStructure, SongInstrumentNotes } from "./SongFormat.js";

// ── Hardcoded asset paths (Phase 1 prototype) ────────────────────────────────

const ATLAS_URL =
    "/@fs/D:/Users/Andrew/Documents/Coding/MusicThing/ChartPlayer/ChartPlayerShared/Content/Textures/UISheet0.png";

const MANIFEST_URL = "/ImageManifest.json";

const SONG_BASE =
    "/@fs/D:/Users/Andrew/Documents/Coding/MusicThing/dlc/dlc/boypablo/tkm";

// ── IWSDK HighwaySystem ───────────────────────────────────────────────────────

class HighwaySystem extends createSystem({}) {
    update(delta: number, _time: number): void {
        const fretScene = this.world.globals.fretScene as FretPlayerScene3D | undefined;
        if (!fretScene) return;
        fretScene.currentSecond += delta;
        fretScene.draw(delta);
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
        sessionMode: SessionMode.ImmersiveVR,
        offer: "always",
        features: { handTracking: true, layers: true },
    },
    features: {
        locomotion: false,
        grabbing: false,
        physics: false,
        sceneUnderstanding: false,
        environmentRaycast: false,
    },
}).then(async (world) => {
    // All critical assets (including atlas texture) are loaded at this point.
    const texture = AssetManager.getTexture("atlas")!;

    // Load image manifest and song JSON files in parallel.
    const [songInfo, songStructure, instrumentNotes] = await Promise.all([
        fetch(`${SONG_BASE}/song.json`).then(r => r.json()) as Promise<SongInfo>,
        fetch(`${SONG_BASE}/arrangement.json`).then(r => r.json()) as Promise<SongStructure>,
        fetch(`${SONG_BASE}/lead.json`).then(r => r.json()) as Promise<SongInstrumentNotes>,
        loadManifest(MANIFEST_URL),
    ]) as [SongInfo, SongStructure, SongInstrumentNotes, void];

    const instrumentPart = songInfo.InstrumentParts[0]; // "lead" / LeadGuitar

    // Create the fret highway scene.
    const fretScene = new FretPlayerScene3D(
        world.renderer,
        texture,
        songStructure,
        instrumentNotes,
        instrumentPart,
    );

    // Register the QuadBatch mesh with the ECS world.
    // persistent: true keeps it alive across level changes.
    world.createTransformEntity(fretScene.mesh, {
        parent: world.sceneEntity,
        persistent: true,
    });

    // Position the camera at the FretCamera's approximate initial pose so the
    // highway is visible without Phase 2's camera-tracking system in place.
    // posX ≈ 72, lookX ≈ 48, posZ = 70 (cameraDistance), lookZ = 70 - 180 = -110
    world.camera.position.set(72, 50, 70);
    world.camera.lookAt(48, 0, -110);
    world.camera.updateProjectionMatrix();

    // Pass the scene to the system via world.globals.
    world.globals.fretScene = fretScene;

    world.registerSystem(HighwaySystem);

    console.log("[XRProto] Phase 1 ready — highway should be scrolling.");
});
