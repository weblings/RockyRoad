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
    protected readonly threeScene: THREE.Scene;
    protected readonly quadBatch: QuadBatch;

    // Fog — maps to THREE.Fog on threeScene
    get fogEnabled(): boolean { return this.threeScene.fog !== null; }
    set fogEnabled(v: boolean) {
        if (v) {
            this.threeScene.fog = new THREE.Fog(
                new THREE.Color(this._fogColor.r, this._fogColor.g, this._fogColor.b),
                this._fogStart,
                this._fogEnd
            );
        } else {
            this.threeScene.fog = null;
        }
    }

    get fogStart(): number { return this._fogStart; }
    set fogStart(v: number) { this._fogStart = v; this._syncFog(); }

    get fogEnd(): number { return this._fogEnd; }
    set fogEnd(v: number) { this._fogEnd = v; this._syncFog(); }

    get fogColor(): UIColor { return this._fogColor; }
    set fogColor(v: UIColor) { this._fogColor = v; this._syncFog(); }

    private _fogStart = 0;
    private _fogEnd = 1000;
    private _fogColor: UIColor = { r: 0, g: 0, b: 0, a: 1 };

    private _syncFog(): void {
        if (this.threeScene.fog instanceof THREE.Fog) {
            this.threeScene.fog.color.setRGB(this._fogColor.r, this._fogColor.g, this._fogColor.b);
            this.threeScene.fog.near = this._fogStart;
            this.threeScene.fog.far  = this._fogEnd;
        }
    }

    // texture is the pre-loaded atlas (UISheet0.png)
    constructor(renderer: THREE.WebGLRenderer, camera: Camera3D, texture: THREE.Texture) {
        this.renderer  = renderer;
        this.camera    = camera;
        this.threeScene = new THREE.Scene();
        this.quadBatch  = new QuadBatch(43688, texture, renderer);

        this.threeScene.add(this.quadBatch.mesh);
    }

    // dt: seconds since last frame — available to subclasses for time-based animation
    draw(dt: number): void {
        this.quadBatch.begin();
        this.drawQuads(dt);
        this.quadBatch.draw(this.renderer, this.threeScene, this.camera.threeCamera);
    }

    // Override in subclasses to submit geometry each frame
    protected drawQuads(_dt: number): void {}

    // --- DrawQuad: full image UVs ---
    // Vertex order: bottomLeft, topLeft, topRight, bottomRight
    // UV Y is inverted: top in 3D = smaller V (higher in texture = smaller pixel Y)
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
        const v0 = image.yOffset / ah;              // top of image in atlas
        const v1 = (image.yOffset + image.height) / ah; // bottom of image in atlas

        this.quadBatch.addQuad([
            { position: bottomLeft,  color: blColor, uv: new THREE.Vector2(u0, v1) },
            { position: topLeft,     color: tlColor, uv: new THREE.Vector2(u0, v0) },
            { position: topRight,    color: trColor, uv: new THREE.Vector2(u1, v0) },
            { position: bottomRight, color: brColor, uv: new THREE.Vector2(u1, v1) },
        ]);
    }

    // --- DrawQuad: sub-rectangle UVs ---
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

    // --- DrawNinePatch ---
    // Positions are interpolated across the quad using 'over' and 'down' vectors,
    // so the nine-patch works in 3D space (not screen space).
    // UV borders are hardcoded to 5%/95% ('blah' in the original) regardless of xCornerSize.
    // xPercents/yPercents (derived from xCornerSize) control position only.
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

        // Note: original uses xCornerSize/image.Width for both axes (yCornerSize unused in C#)
        const yp1 = xCornerSize / image.width;
        const yPercents = [0, yp1, 1 - yp1, 1];

        // UV borders are hardcoded to 5%/95% in the original ('blah' array)
        const uvBorder = [0, 0.05, 0.95, 1.0];

        const xTexCoords = xPercents.map(p => (image.xOffset + p * image.width)  / aw);
        const yTexCoords = yPercents.map(p => (image.yOffset + p * image.height) / ah);

        const over = topRight.clone().sub(topLeft);
        const down = bottomLeft.clone().sub(topLeft);

        for (let x = 0; x < 3; x++) {
            for (let y = 0; y < 3; y++) {
                const verts: [QuadVert, QuadVert, QuadVert, QuadVert] = [
                    // Bottom Left
                    {
                        position: topLeft.clone().addScaledVector(over, uvBorder[x]).addScaledVector(down, uvBorder[y + 1]),
                        color,
                        uv: new THREE.Vector2(xTexCoords[x], yTexCoords[y + 1]),
                    },
                    // Top Left
                    {
                        position: topLeft.clone().addScaledVector(over, uvBorder[x]).addScaledVector(down, uvBorder[y]),
                        color,
                        uv: new THREE.Vector2(xTexCoords[x], yTexCoords[y]),
                    },
                    // Top Right
                    {
                        position: topLeft.clone().addScaledVector(over, uvBorder[x + 1]).addScaledVector(down, uvBorder[y]),
                        color,
                        uv: new THREE.Vector2(xTexCoords[x + 1], yTexCoords[y]),
                    },
                    // Bottom Right
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
