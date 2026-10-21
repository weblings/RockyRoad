import * as THREE from "three";
import { App } from "./App";
import { SongLibraryScreen } from "./SongLibraryScreen";
import { loadManifest } from "../shared/UIImage";

async function main() {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const app = new App(canvas);

    await loadManifest(`${import.meta.env.BASE_URL}ImageManifest.json`);
    const texture = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}UISheet0.png`);

    app.navigate(new SongLibraryScreen(app, texture));
}

main();
