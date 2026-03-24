import * as THREE from "three";
import { Camera3D } from "./Camera3D";
import { QuadBatch, type QuadVert } from "./QuadBatch";
import type { UIColor } from "./UIColor";
import type { UIImage } from "./UIImage";

export interface SrcRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export class Scene3D {
    readonly camera: Camera3D;

    protected readonly renderer: THREE.WebGLRenderer;
    protected readonly quadBatch: QuadBatch;

    // Expose the underlying mesh so the IWSDK host can register it as a transform entity.
    get mesh(): THREE.Mesh { return this.quadBatch.mesh; }

    // Fog — kept for API compatibility; applied to a private scene not used for rendering.
    // In IWSDK mode, fog would need to be applied to world.scene directly if desired.
    get fogEnabled(): boolean { return this._fogEnabled; }
    set fogEnabled(v: boolean) { this._fogEnabled = v; }

    get fogStart(): number { return this._fogStart; }
    set fogStart(v: number) { this._fogStart = v; }

    get fogEnd(): number { return this._fogEnd; }
    set fogEnd(v: number) { this._fogEnd = v; }

    get fogColor(): UIColor { return this._fogColor; }
    set fogColor(v: UIColor) { this._fogColor = v; }

    private _fogEnabled = false;
    private _fogStart = 0;
    private _fogEnd = 1000;
    private _fogColor: UIColor = { r: 0, g: 0, b: 0, a: 1 };

    constructor(renderer: THREE.WebGLRenderer, camera: Camera3D, texture: THREE.Texture) {
        this.renderer  = renderer;
        this.camera    = camera;
        this.quadBatch = new QuadBatch(43688, texture, renderer);
        // Mesh is NOT added to any scene here — the IWSDK host registers it via
        // world.createTransformEntity(scene.mesh) after construction.
    }

    draw(dt: number): void {
        this.quadBatch.begin();
        this.drawQuads(dt);
        this.quadBatch.flush();
    }

    protected drawQuads(_dt: number): void {}

    // No-op in Phase 1 — TextBatch deferred until text rendering is needed in XR.
    protected drawText(
        _text: string,
        _position: THREE.Vector3,
        _color: UIColor,
        _imageScale: number,
        _rightAlign = false,
    ): void {}

    drawQuad(
        image: UIImage,
        bottomLeft: THREE.Vector3, blColor: UIColor,
        topLeft:    THREE.Vector3, tlColor: UIColor,
        topRight:   THREE.Vector3, trColor: UIColor,
        bottomRight:THREE.Vector3, brColor: UIColor,
    ): void {
        const aw = image.actualWidth;
        const ah = image.actualHeight;
        const u0 = image.xOffset / aw;
        const u1 = (image.xOffset + image.width) / aw;
        const v0 = image.yOffset / ah;
        const v1 = (image.yOffset + image.height) / ah;

        this.quadBatch.addQuad([
            { position: bottomLeft,  color: blColor, uv: new THREE.Vector2(u0, v1) },
            { position: topLeft,     color: tlColor, uv: new THREE.Vector2(u0, v0) },
            { position: topRight,    color: trColor, uv: new THREE.Vector2(u1, v0) },
            { position: bottomRight, color: brColor, uv: new THREE.Vector2(u1, v1) },
        ]);
    }

    drawQuadSrc(
        image: UIImage,
        src: SrcRect,
        bottomLeft: THREE.Vector3, blColor: UIColor,
        topLeft:    THREE.Vector3, tlColor: UIColor,
        topRight:   THREE.Vector3, trColor: UIColor,
        bottomRight:THREE.Vector3, brColor: UIColor,
    ): void {
        const aw = image.actualWidth;
        const ah = image.actualHeight;
        const u0 = (image.xOffset + src.left)  / aw;
        const u1 = (image.xOffset + src.right) / aw;
        const v0 = (image.yOffset + src.top)    / ah;
        const v1 = (image.yOffset + src.bottom) / ah;

        this.quadBatch.addQuad([
            { position: bottomLeft,  color: blColor, uv: new THREE.Vector2(u0, v1) },
            { position: topLeft,     color: tlColor, uv: new THREE.Vector2(u0, v0) },
            { position: topRight,    color: trColor, uv: new THREE.Vector2(u1, v0) },
            { position: bottomRight, color: brColor, uv: new THREE.Vector2(u1, v1) },
        ]);
    }

    drawNinePatch(
        image: UIImage,
        xCornerSize: number,
        _yCornerSize: number,
        bottomLeft: THREE.Vector3,
        topLeft:    THREE.Vector3,
        topRight:   THREE.Vector3,
        _bottomRight:THREE.Vector3,
        color: UIColor,
    ): void {
        const aw = image.actualWidth;
        const ah = image.actualHeight;

        const xp1 = xCornerSize / image.width;
        const xPercents = [0, xp1, 1 - xp1, 1];

        const yp1 = xCornerSize / image.width;
        const yPercents = [0, yp1, 1 - yp1, 1];

        const uvBorder = [0, 0.05, 0.95, 1.0];

        const xTexCoords = xPercents.map(p => (image.xOffset + p * image.width)  / aw);
        const yTexCoords = yPercents.map(p => (image.yOffset + p * image.height) / ah);

        const over = topRight.clone().sub(topLeft);
        const down = bottomLeft.clone().sub(topLeft);

        for (let x = 0; x < 3; x++) {
            for (let y = 0; y < 3; y++) {
                const verts: [QuadVert, QuadVert, QuadVert, QuadVert] = [
                    {
                        position: topLeft.clone().addScaledVector(over, uvBorder[x]).addScaledVector(down, uvBorder[y + 1]),
                        color,
                        uv: new THREE.Vector2(xTexCoords[x], yTexCoords[y + 1]),
                    },
                    {
                        position: topLeft.clone().addScaledVector(over, uvBorder[x]).addScaledVector(down, uvBorder[y]),
                        color,
                        uv: new THREE.Vector2(xTexCoords[x], yTexCoords[y]),
                    },
                    {
                        position: topLeft.clone().addScaledVector(over, uvBorder[x + 1]).addScaledVector(down, uvBorder[y]),
                        color,
                        uv: new THREE.Vector2(xTexCoords[x + 1], yTexCoords[y]),
                    },
                    {
                        position: topLeft.clone().addScaledVector(over, uvBorder[x + 1]).addScaledVector(down, uvBorder[y + 1]),
                        color,
                        uv: new THREE.Vector2(xTexCoords[x + 1], yTexCoords[y + 1]),
                    },
                ];

                this.quadBatch.addQuad(verts);
            }
        }
    }

    destroy(): void {
        this.quadBatch.destroy();
    }
}
