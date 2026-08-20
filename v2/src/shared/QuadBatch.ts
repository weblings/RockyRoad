import * as THREE from "three";
import type { UIColor } from "./UIColor";

export interface QuadVert {
    position: THREE.Vector3;
    color: UIColor;
    uv: THREE.Vector2;
    // 0-1 across a quad's short axis for the fragment shader's edge-darkening outline;
    // -1 (default) disables it entirely for this vertex/quad. See QuadBatch's fragment shader.
    edgeT?: number;
}

export class QuadBatch {
    private readonly maxQuads: number;
    private numQuads = 0;

    private readonly positions: Float32Array;
    private readonly colors: Float32Array;
    private readonly uvs: Float32Array;
    private readonly edgeTs: Float32Array;

    readonly geometry: THREE.BufferGeometry;
    readonly material: THREE.ShaderMaterial;
    readonly mesh: THREE.Mesh;

    constructor(maxQuads: number, texture: THREE.Texture, renderer: THREE.WebGLRenderer) {
        this.maxQuads = maxQuads;

        this.positions = new Float32Array(maxQuads * 4 * 3);
        this.colors    = new Float32Array(maxQuads * 4 * 4); // RGBA — 4 floats per vertex
        this.uvs       = new Float32Array(maxQuads * 4 * 2);
        this.edgeTs    = new Float32Array(maxQuads * 4).fill(-1); // -1 = outline disabled

        // Static index buffer — [0,1,2, 0,2,3] per quad, offset by quad*4.
        // Uint32Array: original C# used uint16 but 43688 quads * 4 verts = 174752,
        // which overflows uint16 (max 65535). WebGL2 supports 32-bit indices natively.
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
        this.geometry.setAttribute("edgeT",    new THREE.BufferAttribute(this.edgeTs, 1));
        this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        this.geometry.setDrawRange(0, 0);

        // AnisotropicClamp equivalent (Scene3D.md: SamplerState.AnisotropicClamp)
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        // Our UV math uses image convention: Y=0 at top. Three.js defaults to flipY=true
        // (OpenGL convention: Y=0 at bottom), so disable the flip to match.
        texture.flipY = false;
        texture.needsUpdate = true;

        // Custom ShaderMaterial — MeshBasicMaterial ignores vertex alpha.
        // All rendering is draw-order / painter's algorithm; no depth testing.
        this.material = new THREE.ShaderMaterial({
            uniforms: { map: { value: texture } },
            vertexShader: /* glsl */`
                attribute vec4 color;
                attribute float edgeT;
                varying vec4 vColor;
                varying vec2 vUv;
                varying float vEdgeT;
                void main() {
                    vColor = color;
                    vUv = uv;
                    vEdgeT = edgeT;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D map;
                varying vec4 vColor;
                varying vec2 vUv;
                varying float vEdgeT;
                void main() {
                    vec4 texColor = texture2D(map, vUv) * vColor;
                    // edgeT >= 0 opts a quad into a dark-edge outline: 0/1 at the two
                    // opposite edges of its short axis, interpolated to a V-shape (0 at
                    // the center, 1 at both edges) so a single quad reads as outlined
                    // without a second draw call or a pre-baked gradient texture.
                    if (vEdgeT >= 0.0) {
                        float edgeDist = abs(vEdgeT - 0.5) * 2.0;
                        float outline = smoothstep(0.55, 1.0, edgeDist);
                        texColor.rgb = mix(texColor.rgb, vec3(0.0), outline);
                    }
                    gl_FragColor = texColor;
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
        });

        // World transform is always identity — geometry is submitted in world space.
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.matrixAutoUpdate = false;
        this.mesh.matrixWorld.identity();
        this.mesh.frustumCulled = false; // dynamic geometry, skip frustum check
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

            this.edgeTs[vi + i] = v.edgeT ?? -1;
        }

        this.numQuads++;
    }

    // Mark buffers dirty and set draw range — called by draw() and also directly
    // in XR mode where the IWSDK render loop handles the actual draw call.
    flush(): void {
        const attrs = this.geometry.attributes;
        (attrs.position as THREE.BufferAttribute).needsUpdate = true;
        (attrs.color    as THREE.BufferAttribute).needsUpdate = true;
        (attrs.uv       as THREE.BufferAttribute).needsUpdate = true;
        (attrs.edgeT    as THREE.BufferAttribute).needsUpdate = true;
        this.geometry.setDrawRange(0, this.numQuads * 6);
    }

    // Flush then immediately render — used in desktop mode where Scene3D owns the render call.
    draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
        this.flush();
        renderer.render(scene, camera);
    }

    destroy(): void {
        this.geometry.dispose();
        this.material.dispose();
    }
}
