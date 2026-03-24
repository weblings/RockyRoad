import * as THREE from "three";
import type { UIColor } from "./UIColor";

export interface QuadVert {
    position: THREE.Vector3;
    color: UIColor;
    uv: THREE.Vector2;
}

export class QuadBatch {
    private readonly maxQuads: number;
    private numQuads = 0;

    private readonly positions: Float32Array;
    private readonly colors: Float32Array;
    private readonly uvs: Float32Array;

    readonly geometry: THREE.BufferGeometry;
    readonly material: THREE.ShaderMaterial;
    readonly mesh: THREE.Mesh;

    constructor(maxQuads: number, texture: THREE.Texture, renderer: THREE.WebGLRenderer) {
        this.maxQuads = maxQuads;

        this.positions = new Float32Array(maxQuads * 4 * 3);
        this.colors    = new Float32Array(maxQuads * 4 * 4);
        this.uvs       = new Float32Array(maxQuads * 4 * 2);

        const indices = new Uint32Array(maxQuads * 6);
        const quadIndices = [0, 1, 2, 0, 2, 3];
        for (let quad = 0; quad < maxQuads; quad++) {
            const base = quad * 6;
            const vertBase = quad * 4;
            for (let i = 0; i < 6; i++) {
                indices[base + i] = quadIndices[i] + vertBase;
            }
        }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("color",    new THREE.BufferAttribute(this.colors, 4));
        this.geometry.setAttribute("uv",       new THREE.BufferAttribute(this.uvs, 2));
        this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        this.geometry.setDrawRange(0, 0);

        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.flipY = false;
        texture.needsUpdate = true;

        this.material = new THREE.ShaderMaterial({
            uniforms: { map: { value: texture } },
            vertexShader: /* glsl */`
                attribute vec4 color;
                varying vec4 vColor;
                varying vec2 vUv;
                void main() {
                    vColor = color;
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D map;
                varying vec4 vColor;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = texture2D(map, vUv) * vColor;
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.matrixAutoUpdate = false;
        this.mesh.matrixWorld.identity();
        this.mesh.frustumCulled = false;
    }

    begin(): void {
        this.numQuads = 0;
    }

    addQuad(verts: [QuadVert, QuadVert, QuadVert, QuadVert]): void {
        if (this.numQuads >= this.maxQuads) {
            throw new Error("QuadBatch: maximum quad count exceeded");
        }

        const vi = this.numQuads * 4;

        for (let i = 0; i < 4; i++) {
            const v = verts[i];
            const pi = (vi + i) * 3;
            const ci = (vi + i) * 4;
            const ui = (vi + i) * 2;

            this.positions[pi]     = v.position.x;
            this.positions[pi + 1] = v.position.y;
            this.positions[pi + 2] = v.position.z;

            this.colors[ci]     = v.color.r;
            this.colors[ci + 1] = v.color.g;
            this.colors[ci + 2] = v.color.b;
            this.colors[ci + 3] = v.color.a;

            this.uvs[ui]     = v.uv.x;
            this.uvs[ui + 1] = v.uv.y;
        }

        this.numQuads++;
    }

    // Mark buffers dirty and set draw range — IWSDK's render loop handles the actual draw call.
    flush(): void {
        const attrs = this.geometry.attributes;
        (attrs.position as THREE.BufferAttribute).needsUpdate = true;
        (attrs.color    as THREE.BufferAttribute).needsUpdate = true;
        (attrs.uv       as THREE.BufferAttribute).needsUpdate = true;
        this.geometry.setDrawRange(0, this.numQuads * 6);
    }

    destroy(): void {
        this.geometry.dispose();
        this.material.dispose();
    }
}
