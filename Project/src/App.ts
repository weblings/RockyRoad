import * as THREE from "three";
import type { Scene3D } from "./Scene3D";

export class App {
    readonly renderer: THREE.WebGLRenderer;
    activeScene: Scene3D | null = null;

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
