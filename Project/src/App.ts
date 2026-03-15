import * as THREE from "three";
import type { ChartScene3D } from "./ChartScene3D";
import type { SongPlayer } from "./SongPlayer";

export class App {
    readonly renderer: THREE.WebGLRenderer;
    activeScene: ChartScene3D | null = null;
    songPlayer: SongPlayer | null = null;

    private lastTime = 0;

    constructor(canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(devicePixelRatio);

        new ResizeObserver(() => this.onResize()).observe(canvas);
        this.onResize();

        requestAnimationFrame(t => this.loop(t));
    }

    private loop(time: number): void {
        const dt = Math.min((time - this.lastTime) / 1000, 0.1);
        this.lastTime = time;

        if (this.activeScene && this.songPlayer) {
            this.activeScene.currentSecond = this.songPlayer.currentSecond;
        }

        this.activeScene?.draw(dt);
        requestAnimationFrame(t => this.loop(t));
    }

    private onResize(): void {
        const w = this.renderer.domElement.clientWidth;
        const h = this.renderer.domElement.clientHeight;
        this.renderer.setSize(w, h, false);
        this.activeScene?.camera.setViewport(w, h);
    }
}
