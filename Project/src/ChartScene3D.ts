import * as THREE from "three";
import { Camera3D } from "./Camera3D";
import { Scene3D } from "./Scene3D";
import { clamp } from "./MathUtil";
import { makeColor } from "./UIColor";
import { getImage } from "./UIImage";
import type { ISongEvent, SongStructure } from "./SongFormat";

export class ChartScene3D extends Scene3D {
    noteDisplaySeconds = 3;
    noteDisplayDistance = 600;
    currentTimeOffset = 0;  // time-axis display offset; 0 = no offset
    currentBPM = 0;

    // Mock time provider — incremented by dt each frame.
    // Replace with SongPlayer.currentSecond in Phase 4.
    currentSecond = 0;

    protected timeScale = 0;
    protected currentTime = 0;
    protected startTime = 0;
    protected endTime = 0;

    // Highway X bounds for beat lines — subclasses override
    protected highwayStartX = -5;
    protected highwayEndX = 5;

    private songStructure: SongStructure;
    private startBeatPosition = 0;

    constructor(
        renderer: THREE.WebGLRenderer,
        camera: Camera3D,
        texture: THREE.Texture,
        songStructure: SongStructure,
    ) {
        super(renderer, camera, texture);
        this.songStructure = songStructure;
    }

    override draw(dt: number): void {
        this.timeScale = this.noteDisplayDistance / this.noteDisplaySeconds;

        // currentSecond is set each frame by App from SongPlayer.currentSecond
        this.currentTime = this.currentSecond;
        this.startTime = this.currentTime;
        this.endTime = this.currentTime + this.noteDisplaySeconds;

        this.updateCamera(dt);

        super.draw(dt);
    }

    // Virtual — subclasses position the camera before geometry is submitted
    protected updateCamera(_dt: number): void {}

    protected override drawQuads(dt: number): void {
        super.drawQuads(dt);
        this.drawBeats();
    }

    protected drawBeats(): void {
        this.currentBPM = 0;

        let lastBeatTime = 0;
        const beats = this.songStructure.Beats;

        this.startBeatPosition = getStartNote(
            this.currentTime - this.currentTimeOffset,
            0,
            this.startBeatPosition,
            beats,
        );

        for (let pos = this.startBeatPosition; pos < beats.length; pos++) {
            const beat = beats[pos];

            if (beat.TimeOffset > this.endTime) break;

            this.drawBeat(beat.TimeOffset, beat.IsMeasure ?? false);

            if (lastBeatTime === 0) {
                lastBeatTime = beat.TimeOffset;
            } else if (this.currentBPM === 0) {
                const delta = beat.TimeOffset - lastBeatTime;
                this.currentBPM = (1 / delta) * 60;
            }
        }
    }

    protected drawBeat(timeOffset: number, isMeasure: boolean): void {
        const alpha = isMeasure ? 0.5 : 0.25;
        const color = makeColor(1, 1, 1, alpha);
        const thickness = isMeasure ? 0.12 : 0.08;

        this.drawHorizontalLine(
            this.highwayStartX, this.highwayEndX,
            timeOffset, 0,
            color, thickness,
        );
    }

    protected drawHorizontalLine(
        startX: number, endX: number,
        time: number, heightOffset: number,
        color: ReturnType<typeof makeColor>,
        imageScale: number,
    ): void {
        const z = time * -this.timeScale;
        const image = getImage("HorizontalFretLine");
        const halfThick = image.height * imageScale;

        this.drawQuad(
            image,
            new THREE.Vector3(startX, heightOffset, z + halfThick), color,
            new THREE.Vector3(startX, heightOffset, z - halfThick), color,
            new THREE.Vector3(endX,   heightOffset, z - halfThick), color,
            new THREE.Vector3(endX,   heightOffset, z + halfThick), color,
        );
    }
}

// --- Note window search helpers ---
// O(1) in steady state via the startPos hint that persists across frames.

export function getStartNote<T extends ISongEvent>(
    timeOffset: number,
    minLength: number,
    startPos: number,
    notes: T[],
): number {
    if (notes.length === 0) return 0;

    startPos = clamp(startPos, 0, notes.length - 1);

    // Walk backward while notes are still visible
    while (startPos > 0) {
        const n = notes[startPos];
        const endTime = Math.max(n.EndTime ?? (n.TimeOffset + (n.TimeLength ?? 0)), n.TimeOffset + minLength);
        if (endTime < timeOffset) break;
        startPos--;
    }

    // Walk forward until we reach a visible note
    while (startPos < notes.length) {
        const n = notes[startPos];
        const endTime = Math.max(n.EndTime ?? (n.TimeOffset + (n.TimeLength ?? 0)), n.TimeOffset + minLength);
        if (endTime > timeOffset) break;
        startPos++;
    }

    return startPos;
}

export function getEndNote<T extends ISongEvent>(
    startPos: number,
    endTime: number,
    notes: T[],
): number {
    while (startPos < notes.length) {
        if (notes[startPos].TimeOffset > endTime) break;
        startPos++;
    }

    return Math.max(0, Math.min(startPos, notes.length - 1));
}
