import * as THREE from "three";
import { Camera3D } from "./Camera3D";
import { ChartScene3D, getStartNote } from "./ChartScene3D";
import { lerp } from "./MathUtil";
import { makeColor, fromHex, type UIColor } from "./UIColor";
import { getImage } from "./UIImage";
import type { UIImage } from "./UIImage";
import type { SongKeyboardNotes, SongStructure } from "./SongFormat";

// Piano key layout — same arrays as C# source.
// Index = semitone offset from minKey within the octave.
// ScaleWhiteBlack: 0 = white key, 1 = black key.
const SCALE_WHITE_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
// ScaleOffsets: white-key-width units from the left edge of the octave.
const SCALE_OFFSETS     = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];

export class KeysPlayerScene3D extends ChartScene3D {
    minKey = 21;   // A0 — standard 88-key lower bound
    maxKey = 108;  // C8 — standard 88-key upper bound

    // When true, camera looks straight down (piano-roll style) instead of the
    // default angled perspective view. Future notes appear at the top of the screen.
    // XR note: topDown only affects updateCamera(); in headset mode updateCamera()
    // is a no-op (HMD owns the camera), so topDown has no effect in XR.
    topDown = false;

    rightHandColor: UIColor = fromHex('#2E71D6');
    leftHandColor:  UIColor = fromHex('#E33737');

    private targetCameraDistance = 64;
    private cameraDistance = 70;
    private positionKey: number;
    private startNotePosition = 0;
    private readonly keyboardNotes: SongKeyboardNotes;

    constructor(
        renderer: THREE.WebGLRenderer,
        texture: THREE.Texture,
        songStructure: SongStructure,
        keyboardNotes: SongKeyboardNotes,
    ) {
        const size = renderer.getSize(new THREE.Vector2());
        const camera = new Camera3D(size.x, size.y);
        super(renderer, camera, texture, songStructure);
        this.keyboardNotes = keyboardNotes;
        this.positionKey = (this.maxKey + this.minKey) / 2;
        this.syncHighwayBounds();
        this.cameraDistance = this.computeTargetCameraDistance();
    }

    // Call after changing minKey/maxKey to sync highway bounds, camera distance,
    // and positionKey to the new range.
    syncHighwayBounds(): void {
        this.highwayStartX  = this.getKeyPosition(this.minKey);
        this.highwayEndX    = this.getKeyPosition(this.maxKey + 2);
        this.positionKey    = (this.maxKey + this.minKey) / 2;
        this.cameraDistance = this.computeTargetCameraDistance();
    }

    private computeTargetCameraDistance(): number {
        const keyDist = Math.max(this.maxKey - this.minKey - 12, 0);
        return 60 + Math.max(keyDist, 4) * 3;
    }

    // Copy the scene camera's computed pose to an external camera (e.g. world.camera).
    // Must be called after draw() so updateCamera() has already populated camera.threeCamera.
    //
    // If anchor is supplied, the local-space camera position is mapped through
    // anchor.matrixWorld into world space. Use in desktop mode when the highway
    // mesh is parented under a scaled anchor entity.
    syncCameraTo(target: THREE.PerspectiveCamera, anchor?: THREE.Object3D): void {
        const src = this.camera.threeCamera;
        if (anchor) {
            const localPos    = src.position.clone();
            const localTarget = src.position.clone().add(
                new THREE.Vector3(0, 0, -1).applyQuaternion(src.quaternion),
            );
            target.position.copy(localPos.applyMatrix4(anchor.matrixWorld));
            target.lookAt(localTarget.applyMatrix4(anchor.matrixWorld));
        } else {
            target.position.copy(src.position);
            target.quaternion.copy(src.quaternion);
        }
        target.fov = src.fov;
        target.updateProjectionMatrix();
    }

    protected override updateCamera(dt: number): void {
        const nowZ = this.toZ(this.currentTime); // always 0 in local space
        const midKey = (this.maxKey + this.minKey) / 2;
        const camX = this.getKeyPosition(midKey);

        if (this.topDown) {
            // Piano-roll style: camera directly overhead looking straight down.
            // Future notes appear at the top of the screen, now-line near the bottom.
            //
            // camera.setLookAt() breaks for straight-down views (degenerate cross
            // product), so we set threeCamera directly.
            const cam = this.camera.threeCamera;
            const fovRad = THREE.MathUtils.degToRad(cam.fov);
            const tanHalfFov = Math.tan(fovRad / 2);
            const keyboardWidth = this.highwayEndX - this.highwayStartX;
            // Height so the full keyboard fills ~90% of viewport width.
            const heightForKeyboard = (keyboardWidth * 1.1) / (2 * tanHalfFov * cam.aspect);
            // Minimum height to guarantee at least 2 seconds of notes visible.
            const heightForTime = (2 * this.timeScale) / (2 * tanHalfFov);
            const height = Math.max(heightForKeyboard, heightForTime);
            // Half the Z extent visible in the viewport.
            const visibleHalfZ = height * tanHalfFov;
            // Place the now-line at 85% from the top (15% past below, 85% future above).
            const cameraZ = nowZ - visibleHalfZ * 0.7;

            cam.position.set(camX, height, cameraZ);
            // up = -Z puts future notes (more-negative Z) at the top of the screen.
            cam.up.set(0, 0, -1);
            cam.lookAt(camX, 0, cameraZ);
            return;
        }

        // --- Default angled perspective view ---
        this.targetCameraDistance = this.computeTargetCameraDistance();

        const targetPositionKey = midKey;

        // Frame-rate independent lerp — C# used 0.01/frame at assumed 60fps.
        const rate = 1 - Math.pow(1 - 0.01, dt * 60);
        this.positionKey      = lerp(this.positionKey, targetPositionKey, rate);
        this.cameraDistance   = lerp(this.cameraDistance, this.targetCameraDistance, rate);

        // 70 units behind the now-line (now-line is at Z=0 in local space).
        const camZ = nowZ + 70;

        this.camera.position.set(camX, 50, camZ);
        this.camera.setLookAt(new THREE.Vector3(
            camX,
            0,
            camZ - this.noteDisplaySeconds * this.timeScale * 0.3,
        ));
    }

    protected override drawQuads(dt: number): void {
        if (this.topDown) {
            // All geometry is at Y=0 so depth-based fog has no meaning top-down.
            this.fogEnabled = false;
        } else {
            this.fogEnabled = true;
            this.fogStart   = 400;
            this.fogEnd     = this.cameraDistance + this.noteDisplaySeconds * this.timeScale;
            this.fogColor   = { r: 0, g: 0, b: 0, a: 1 };
        }

        // Draws beat lines via ChartScene3D
        super.drawQuads(dt);

        const whiteHalfAlpha = makeColor(1, 1, 1, 0.5);

        // Lane dividers on white keys (loop to maxKey+2 matches C# source)
        for (let key = this.minKey; key <= this.maxKey + 2; key++) {
            if (SCALE_WHITE_BLACK[key % 12] === 0) {
                this.drawKeyTimeLine(key, 0, this.startTime, this.endTime, whiteHalfAlpha);
            }
        }

        // Note trails
        const allNotes = this.keyboardNotes.Notes;
        this.startNotePosition = getStartNote(
            this.currentTime,
            0.15,
            this.startNotePosition,
            allNotes,
        );

        for (let pos = this.startNotePosition; pos < allNotes.length; pos++) {
            const note = allNotes[pos];
            if (note.TimeOffset > this.endTime) break;
            if (note.Note < this.minKey || note.Note > this.maxKey) continue;

            const isWhite    = SCALE_WHITE_BLACK[note.Note % 12] === 0;
            const trailStart = Math.max(note.TimeOffset, this.currentTime);
            const color      = note.Hand === 'left' ? this.leftHandColor : this.rightHandColor;

            this.drawFlatImage(
                getImage(isWhite ? "NoteTrailWhite" : "NoteTrailBlack"),
                note.Note + 0.5,
                trailStart,
                note.TimeOffset + note.TimeLength,
                0,
                color,
                0.06,
            );
        }
    }

    // Maps MIDI note number to world X coordinate.
    // One octave = 7 white keys = 56 world units (ScaleOffsets * 8).
    // Fractional keys interpolate linearly (used for centering note trails).
    //
    // Uses absolute chromatic position (key % 12) so the layout is correct for
    // any minKey — not just C notes.
    private getKeyPosition(key: number): number {
        const intKey = Math.floor(key);

        if (key === intKey) {
            // Absolute white-key offset from C0 for any MIDI note.
            const absOffset = (k: number) =>
                SCALE_OFFSETS[k % 12] + Math.floor(k / 12) * 7;
            return (absOffset(intKey) - absOffset(this.minKey)) * 8;
        }

        const pos = this.getKeyPosition(intKey);
        return lerp(pos, pos + 8, key - intKey);
    }

    // Draws a vertical line spanning the visible time window at a given key position.
    // Used for white-key lane dividers.
    private drawKeyTimeLine(
        keyCenter: number,
        height: number,
        startTime: number,
        endTime: number,
        color: ReturnType<typeof makeColor>,
    ): void {
        const x      = this.getKeyPosition(keyCenter);
        const startZ = this.toZ(startTime);
        const endZ   = this.toZ(endTime);

        const image      = getImage("VerticalFretLine");
        const imageScale = 0.03;
        const minX       = x - image.width * imageScale;
        const maxX       = x + image.width * imageScale;

        this.drawQuad(
            image,
            new THREE.Vector3(minX, height, startZ), color,
            new THREE.Vector3(minX, height, endZ),   color,
            new THREE.Vector3(maxX, height, endZ),   color,
            new THREE.Vector3(maxX, height, startZ), color,
        );
    }

    // Draws a flat (XZ-plane) quad for a note trail.
    private drawFlatImage(
        image: UIImage,
        keyCenter: number,
        startTime: number,
        endTime: number,
        heightOffset: number,
        color: ReturnType<typeof makeColor>,
        imageScale: number,
    ): void {
        const x      = this.getKeyPosition(keyCenter);
        const startZ = this.toZ(startTime);
        const endZ   = this.toZ(endTime);
        const minX   = x - image.width * imageScale;
        const maxX   = x + image.width * imageScale;

        this.drawQuad(
            image,
            new THREE.Vector3(minX, heightOffset, startZ), color,
            new THREE.Vector3(minX, heightOffset, endZ),   color,
            new THREE.Vector3(maxX, heightOffset, endZ),   color,
            new THREE.Vector3(maxX, heightOffset, startZ), color,
        );
    }
}
