import { Camera3D } from "./Camera3D";
import { lerp, clamp } from "./MathUtil";

const SCALE_LENGTH = 300;

export function getFretPosition(fret: number): number {
    return SCALE_LENGTH - SCALE_LENGTH / Math.pow(2, fret / 12);
}

export class FretCamera extends Camera3D {
    cameraDistance = 70;
    readonly focusDist = 600;

    private targetCameraDistance = 75;
    private positionFret = 3;

    update(minFret: number, maxFret: number, targetFocusFret: number, focusY: number, dt: number): void {
        if (minFret <= maxFret) {
            let fretDist = maxFret - minFret - 12;
            if (fretDist < 0) fretDist = 0;

            this.targetCameraDistance = 65 + Math.max(fretDist, 4) * 3;

            let targetPositionFret = (maxFret + minFret) / 2;
            if (targetPositionFret < targetFocusFret - 3) targetPositionFret = targetFocusFret - 3;
            if (targetPositionFret > targetFocusFret + 5) targetPositionFret = targetFocusFret + 5;

            const rate02 = 1 - Math.pow(0.98, dt * 60);
            this.positionFret = lerp(this.positionFret, clamp(targetPositionFret, 3.5, 24) - 1, rate02);
        }

        const rate01 = 1 - Math.pow(0.99, dt * 60);
        this.cameraDistance = lerp(this.cameraDistance, this.targetCameraDistance, rate01);

        const fretOffset = (10 - this.positionFret) / 4;
        const posX  = getFretPosition(this.positionFret + fretOffset);
        const lookX = getFretPosition(this.positionFret);
        const posZ  = focusY + this.cameraDistance;

        this.threeCamera.position.set(posX, 50, posZ);
        this.threeCamera.lookAt(lookX, 0, posZ - this.focusDist * 0.3);
    }
}
