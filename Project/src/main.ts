import * as THREE from "three";
import { App } from "./App";
import { FretPlayerScene3D } from "./FretPlayerScene3D";
import { SongPlayer } from "./SongPlayer";
import { loadManifest } from "./UIImage";
import type { SongStructure, SongInstrumentNotes, SongInfo, SongInstrumentPart } from "./SongFormat";

const SONG_BASE = "/@fs/D:/Users/Andrew/Documents/Coding/MusicThing/dlc/dlc/boypablo/tkm";

async function main() {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const app = new App(canvas);

    await loadManifest("/ImageManifest.json");

    const [texture, arrangementJson, songInfoJson, notesJson] = await Promise.all([
        new THREE.TextureLoader().loadAsync("/UISheet0.png"),
        fetch(`${SONG_BASE}/arrangement.json`).then(r => r.json()),
        fetch(`${SONG_BASE}/song.json`).then(r => r.json()),
        fetch(`${SONG_BASE}/lead.json`).then(r => r.json()),
    ]);

    const songStructure:   SongStructure        = arrangementJson;
    const songInfo:        SongInfo              = songInfoJson;
    const instrumentNotes: SongInstrumentNotes   = notesJson;

    // Find the lead guitar instrument part from song.json
    const instrumentPart: SongInstrumentPart =
        songInfo.InstrumentParts.find(p => p.InstrumentName === "Lead") ??
        songInfo.InstrumentParts[0];

    const scene = new FretPlayerScene3D(app.renderer, texture, songStructure, instrumentNotes, instrumentPart);

    const songPlayer = new SongPlayer();
    await songPlayer.loadSong(`${SONG_BASE}/song.ogg`);

    // Set to a non-zero value to pre-seek for faster testing (e.g. 10 to skip intro).
    const PREVIEW_OFFSET = 0;
    if (PREVIEW_OFFSET > 0) {
        songPlayer.seekTo(PREVIEW_OFFSET);
        scene.currentSecond = PREVIEW_OFFSET;
    }

    app.songPlayer  = songPlayer;
    app.activeScene = scene;

    // Click canvas to play / pause
    canvas.addEventListener("click", () => {
        if (songPlayer.isPlaying) {
            songPlayer.pause();
        } else {
            songPlayer.play();
        }
    });
}

main();
