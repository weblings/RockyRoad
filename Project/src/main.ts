import * as THREE from "three";
import { App } from "./App";
import { Camera3D } from "./Camera3D";
import { KeysPlayerScene3D } from "./KeysPlayerScene3D";
import { loadManifest } from "./UIImage";
import type { SongStructure, SongKeyboardNotes } from "./SongFormat";

const SONG_BASE = "/@fs/D:/Users/Andrew/Documents/Coding/MusicThing/dlc/dlc/boypablo/tkm";

async function main() {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const app = new App(canvas);

    await loadManifest("/ImageManifest.json");

    const [texture, arrangementJson, keyboardJson] = await Promise.all([
        new THREE.TextureLoader().loadAsync("/UISheet0.png"),
        fetch(`${SONG_BASE}/arrangement.json`).then(r => r.json()),
        fetch("/test-keyboard.json").then(r => r.json()),
    ]);

    const songStructure   = arrangementJson as SongStructure;
    const keyboardNotes   = keyboardJson    as SongKeyboardNotes;

    const camera = new Camera3D(canvas.clientWidth, canvas.clientHeight);
    const scene  = new KeysPlayerScene3D(app.renderer, camera, texture, songStructure, keyboardNotes);

    // Full 88-key range
    scene.minKey = 21;
    scene.maxKey = 108;
    scene.syncHighwayBounds();

    app.activeScene = scene;
}

main();
