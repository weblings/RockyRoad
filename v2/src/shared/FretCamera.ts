import { Camera3D } from "./Camera3D";
import { lerp, clamp } from "./MathUtil";

// Guitar scale length in world units — matches FretPlayerScene3D.cs
const SCALE_LENGTH = 300;

// Returns the world-space X position of a given fret number.
// Based on equal-temperament fret spacing formula.
// Exported so FretPlayerScene3D can use the same function.
export function getFretPosition(fret: number): number {
    return SCALE_LENGTH - SCALE_LENGTH / Math.pow(2, fret / 12);
}

// Port of FretCamera.cs — smooth-tracking camera that follows the active fret region.
// Frame-rate independence: all lerps use  rate = 1 - pow(1 - perFrameRate, dt*60)
// instead of the original per-frame constants (0.02, 0.01).
export class FretCamera extends Camera3D {
    cameraDistance = 70;
    readonly focusDist = 600;

    private targetCameraDistance = 75;
    private _positionFret = 3;

    // Smoothed fret-window center — same value the desktop camera pans/zooms to
    // frame. In XR there's no virtual camera to move, so this drives a content
    // offset instead (see FretPlayerScene3D.contentOffsetX).
    get positionFret(): number { return this._positionFret; }

    // Seeds positionFret instantly instead of waiting for update()'s lerp — call once per new
    // song. Without it, XR notes outside the still-converging volume window (inVolumeFret)
    // don't render until the lerp catches up; desktop has no culling, so it's cosmetic there.
    snapToFret(fret: number): void {
        this._positionFret = clamp(fret, 3.5, 24) - 1;
    }

    // Call every frame with the fret window computed during note drawing.
    // focusY = 0 in local-Z mode (now-line always at Z=0).
    update(minFret: number, maxFret: number, targetFocusFret: number, focusY: number, dt: number): void {
        if (minFret <= maxFret) {
            let fretDist = maxFret - minFret - 12;
            if (fretDist < 0) fretDist = 0;

            this.targetCameraDistance = 65 + Math.max(fretDist, 4) * 3;

            let targetPositionFret = (maxFret + minFret) / 2;
            if (targetPositionFret < targetFocusFret - 3) targetPositionFret = targetFocusFret - 3;
            if (targetPositionFret > targetFocusFret + 5) targetPositionFret = targetFocusFret + 5;

            // 0.02/frame → frame-rate independent
            const rate02 = 1 - Math.pow(0.98, dt * 60);
            this._positionFret = lerp(this._positionFret, clamp(targetPositionFret, 3.5, 24) - 1, rate02);
        }

        // 0.01/frame → frame-rate independent
        const rate01 = 1 - Math.pow(0.99, dt * 60);
        this.cameraDistance = lerp(this.cameraDistance, this.targetCameraDistance, rate01);

        // Camera leans toward the high-string side (fretOffset)
        const fretOffset = (10 - this.positionFret) / 4;
        const posX  = getFretPosition(this.positionFret + fretOffset);
        const lookX = getFretPosition(this.positionFret);
        const posZ  = focusY + this.cameraDistance;

        this.threeCamera.position.set(posX, 50, posZ);
        this.threeCamera.lookAt(lookX, 0, posZ - this.focusDist * 0.3);
    }
}
