import * as THREE from "three";
import type { UIColor } from "./UIColor";

const POOL_SIZE = 128;
const CANVAS_HEIGHT = 64;   // px — fixed texture height
const FONT_SIZE_PX  = 48;   // px — fits within CANVAS_HEIGHT with a few px padding

// World height (scene units) = imageScale * TEXT_WORLD_UNITS_PER_SCALE.
// Mirrors the C# imageScale convention: at 0.12 this gives ~3 world units of text height.
// Tune this constant to adjust global text size without touching call sites.
export const TEXT_WORLD_UNITS_PER_SCALE = 25;

export class TextBatch {
    private readonly pool: THREE.Sprite[];
    private used = 0;

    // Cache keyed by "text:r,g,b,a" — bakes colour and alpha into the canvas texture.
    // Fret numbers (0-24) and common chord names are reused every frame at zero cost.
    private readonly matCache = new Map<string, THREE.SpriteMaterial>();

    constructor(scene: THREE.Scene) {
        this.pool = [];
        for (let i = 0; i < POOL_SIZE; i++) {
            const spr = new THREE.Sprite(
                // Placeholder material — overwritten before each sprite is shown
                new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }),
            );
            spr.visible = false;
            spr.frustumCulled = false;
            scene.add(spr);
            this.pool.push(spr);
        }
    }

    begin(): void {
        for (let i = 0; i < this.used; i++) this.pool[i].visible = false;
        this.used = 0;
    }

    drawText(
        text: string,
        position: THREE.Vector3,
        color: UIColor,
        imageScale: number,
        rightAlign = false,
    ): void {
        if (this.used >= this.pool.length) return; // pool exhausted — silent drop

        const key = `${text}:${color.r.toFixed(2)},${color.g.toFixed(2)},${color.b.toFixed(2)},${color.a.toFixed(2)}`;
        let mat = this.matCache.get(key);
        if (!mat) {
            mat = this.buildMaterial(text, color);
            this.matCache.set(key, mat);
        }

        const spr = this.pool[this.used++];
        spr.material = mat;
        spr.position.copy(position);

        const worldHeight = imageScale * TEXT_WORLD_UNITS_PER_SCALE;
        const tex = mat.map as THREE.CanvasTexture;
        const aspect = tex.image.width / CANVAS_HEIGHT;
        spr.scale.set(worldHeight * aspect, worldHeight, 1);

        // center is in [0,1] UV space: (0.5,0.5)=centred, (1.0,0.5)=right-edge at position
        spr.center.set(rightAlign ? 1.0 : 0.5, 0.5);
        spr.visible = true;
    }

    private buildMaterial(text: string, color: UIColor): THREE.SpriteMaterial {
        // canvas.width must be set before drawing; setting it resets the context state.
        // So: create canvas → measure text width → resize → re-set font → draw.
        const canvas = document.createElement("canvas");
        canvas.height = CANVAS_HEIGHT;

        const ctx = canvas.getContext("2d")!;
        const font = `bold ${FONT_SIZE_PX}px sans-serif`;
        ctx.font = font;
        const textWidth = ctx.measureText(text).width;

        canvas.width = Math.ceil(textWidth) + 16; // 8 px padding each side

        // Re-apply font after canvas resize (resize wipes context state)
        ctx.font = font;
        ctx.textBaseline = "middle";
        ctx.globalAlpha = color.a;

        // Dark stroke for legibility against any highway background
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 6;
        ctx.lineJoin = "round";
        ctx.strokeText(text, 8, CANVAS_HEIGHT / 2);

        ctx.fillStyle = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`;
        ctx.fillText(text, 8, CANVAS_HEIGHT / 2);

        const texture = new THREE.CanvasTexture(canvas);
        return new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            depthTest: false,
        });
    }

    destroy(): void {
        for (const [, mat] of this.matCache) {
            mat.map?.dispose();
            mat.dispose();
        }
        this.matCache.clear();
    }
}
