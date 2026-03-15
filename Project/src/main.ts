import * as THREE from "three";
import { App } from "./App";
import { Camera3D } from "./Camera3D";
import { ChartScene3D } from "./ChartScene3D";
import { loadManifest } from "./UIImage";
import type { SongStructure } from "./SongFormat";

const SONG_BASE = "/@fs/D:/Users/Andrew/Documents/Coding/MusicThing/dlc/dlc/boypablo/tkm";

class TestChartScene extends ChartScene3D {
    constructor(renderer: THREE.WebGLRenderer, camera: Camera3D, texture: THREE.Texture, songStructure: SongStructure) {
        super(renderer, camera, texture, songStructure);
        this.highwayStartX = 0;
        this.highwayEndX = 200;
    }

    protected override updateCamera(_dt: number): void {
        // Camera Z must track currentTime so notes remain near the camera.
        // focusY = -(currentTime * timeScale), matching FretPlayerScene3D line 269.
        // Camera sits 70 units "behind" the now-position, looking 180 units ahead.
        const nowZ = this.currentTime * -this.timeScale;
        const cameraZ = nowZ + 70;
        this.camera.position.set(100, 50, cameraZ);
        this.camera.setLookAt(new THREE.Vector3(100, 0, cameraZ - 180));
    }
}

async function main() {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const app = new App(canvas);

    await loadManifest("/ImageManifest.json");

    const [texture, arrangementJson] = await Promise.all([
        new THREE.TextureLoader().loadAsync("/UISheet0.png"),
        fetch(`${SONG_BASE}/arrangement.json`).then(r => r.json()),
    ]);

    const songStructure = arrangementJson as SongStructure;

    const camera = new Camera3D(canvas.clientWidth, canvas.clientHeight);
    const scene = new TestChartScene(app.renderer, camera, texture, songStructure);
    // Start just before the first musical beat so lines are visible immediately
    scene.currentSecond = 10; // start just before first musical beat

    app.activeScene = scene;
}

main();
