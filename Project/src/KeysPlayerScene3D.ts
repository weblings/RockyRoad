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
    minKey = 48;
    maxKey = 72;

    rightHandColor: UIColor = fromHex('#2E71D6');
    leftHandColor:  UIColor = fromHex('#E33737');

    private targetCameraDistance = 64;
    private cameraDistance = 70;
    private positionKey: number;
    private startNotePosition = 0;
    private readonly keyboardNotes: SongKeyboardNotes;

    constructor(
        renderer: THREE.WebGLRenderer,
        camera: Camera3D,
        texture: THREE.Texture,
        songStructure: SongStructure,
        keyboardNotes: SongKeyboardNotes,
    ) {
        super(renderer, camera, texture, songStructure);
        this.keyboardNotes = keyboardNotes;
        this.positionKey = (this.maxKey + this.minKey) / 2;
        this.syncHighwayBounds();
        // Pre-compute starting camera distance so there's no lerp-in drift.
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

    protected override updateCamera(dt: number): void {
        this.targetCameraDistance = this.computeTargetCameraDistance();

        const targetPositionKey = (this.maxKey + this.minKey) / 2;

        // Frame-rate independent lerp — C# used 0.01/frame at assumed 60fps.
        const rate = 1 - Math.pow(1 - 0.01, dt * 60);
        this.positionKey      = lerp(this.positionKey, targetPositionKey, rate);
        this.cameraDistance   = lerp(this.cameraDistance, this.targetCameraDistance, rate);

        const camX = this.getKeyPosition(this.positionKey);
        const nowZ = this.currentTime * -this.timeScale;
        // 70 units behind the now-line puts it near the bottom of the screen.
        // cameraDistance is still used for fog end, but not Z positioning.
        const camZ = nowZ + 70;

        this.camera.position.set(camX, 50, camZ);
        this.camera.setLookAt(new THREE.Vector3(
            camX,
            0,
            camZ - this.noteDisplaySeconds * this.timeScale * 0.3,
        ));
    }

    protected override drawQuads(dt: number): void {
        this.fogEnabled = true;
        this.fogStart   = 400;
        this.fogEnd     = this.cameraDistance + this.noteDisplaySeconds * this.timeScale;
        this.fogColor   = { r: 0, g: 0, b: 0, a: 1 };

        // Draws beat lines via ChartScene3D
        super.drawQuads(dt);

        const whiteHalfAlpha = makeColor(1, 1, 1, 0.5);

        // Lane dividers on white keys (loop to maxKey+2 matches C# source)
        for (let key = this.minKey; key <= this.maxKey + 2; key++) {
            if (SCALE_WHITE_BLACK[(key - this.minKey) % 12] === 0) {
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

            const isWhite    = SCALE_WHITE_BLACK[(note.Note - this.minKey) % 12] === 0;
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
    private getKeyPosition(key: number): number {
        const intKey = Math.floor(key);

        if (key === intKey) {
            const octave = Math.floor((intKey - this.minKey) / 12);
            return (SCALE_OFFSETS[(intKey - this.minKey) % 12] + octave * 7) * 8;
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
        const startZ = startTime * -this.timeScale;
        const endZ   = endTime   * -this.timeScale;

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
        const startZ = startTime * -this.timeScale;
        const endZ   = endTime   * -this.timeScale;
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
