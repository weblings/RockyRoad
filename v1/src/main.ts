import * as THREE from "three";
import { App } from "./App";
import { SongLibraryScreen } from "./SongLibraryScreen";
import { loadManifest } from "./UIImage";

async function main() {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const app = new App(canvas);

    await loadManifest("/ImageManifest.json");
    const texture = await new THREE.TextureLoader().loadAsync("/UISheet0.png");

    app.navigate(new SongLibraryScreen(app, texture));
}

main();
