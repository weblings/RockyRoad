import * as THREE from "three";
import { createSystem, InputComponent, VisibilityState } from "@iwsdk/core";

// ── CalibrationPointer interface ──────────────────────────────────────────────
//
// Abstracts the input source used to point at a piano key during calibration.
// The controller implementation below reads from grip spaces.
// A future hand-tracking implementation would read the index fingertip joint
// from the raw WebXR Hand Input API and detect a pinch gesture — swap it in
// without touching any calibration logic.

export interface CalibrationPointer {
    /** Writes the current pointer world position into `target`. Returns false if unavailable. */
    getWorldPosition(target: THREE.Vector3): boolean;
    /** True on the frame the confirm gesture fires (trigger down / pinch start). */
    isConfirmDown(): boolean;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CalibrationState = 'idle' | 'prompt_left' | 'prompt_right' | 'prompt_look' | 'done';

type XrButton = { el: HTMLButtonElement; onClick: () => void };

// ── Constants ─────────────────────────────────────────────────────────────────

// Center of A0 (key 21) to center of C8 (key 108) in KeysPlayerScene3D world
// units with minKey=21. Verified: (getKeyPos(21)+getKeyPos(22))/2 = 2,
// (getKeyPos(108)+getKeyPos(109))/2 = 410, distance = 408.
const HIGHWAY_CENTER_TO_CENTER_UNITS = 408;

// Local X coordinate of the midpoint between A0-center and C8-center.
// Used to position the anchor so the highway center lands on the physical midpoint.
const LOCAL_MID_X = 206;

// Standard 88-key piano: A0-center to C8-center ≈ 1.186 m.
// Derived from confirmed-good calibration: scale 0.0029070 × 408 = 1.186 m.
// Controller grip positions are unreliable for scale (grip center ≠ key center,
// and the user's reach arc doesn't span the full keyboard). Using a preset here
// and letting the fine-tune scale buttons handle non-standard keyboards.
const PIANO_SCALE_88 = 1.186 / HIGHWAY_CENTER_TO_CENTER_UNITS; // ≈ 0.002907

// Increment values cycled by the Incr [-][+] buttons.
const INCR_STEPS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0];

// ── CalibrationSystem ─────────────────────────────────────────────────────────

export class CalibrationSystem extends createSystem({}) {
    private state: CalibrationState = 'idle';

    // Steps 1 & 2: grip positions at A0 and C8.
    private leftPoint   = new THREE.Vector3();
    private rightPoint  = new THREE.Vector3();
    private scratchPos  = new THREE.Vector3();

    // Step 3: head look direction captured while the player faces the piano.
    private headLookDir = new THREE.Vector3();

    // ── Fine-tune state ───────────────────────────────────────────────────────

    // Calibrated values — stored at the end of applyCalibration(), used as the
    // base for fine-tune offsets. _calMid is the physical midpoint between the
    // two calibration grips; rotation pivots around it so the piano center stays fixed.
    private _calMid   = new THREE.Vector3();
    private _calQuat  = new THREE.Quaternion();
    private _calScale = 1;

    // Fine-tune offsets applied on top of the calibrated values.
    // Position offsets are in the CURRENT piano local space (recalculated each
    // reapply using effectiveQuat, so they stay aligned with the visible piano
    // regardless of the rotation fine-tune):
    //   +X = along A0→C8,  +Y = up,  +Z = toward player.
    private _ftPX = 0;    // local X offset (m)
    private _ftPY = 0;    // local Y offset (m)
    private _ftPZ = 0;    // local Z offset (m)
    private _ftRY = 0;    // yaw offset (degrees) — pivots around the piano center (_calMid)
    private _ftS  = 1;    // scale multiplier (1.0 = calibrated scale)
    private _ftIncrIdx = 4; // index into INCR_STEPS; starts at 0.1 m

    // Registered fine-tune XrButtons — removed from world.globals.xrButtons on recalibrate.
    private _ftButtons: XrButton[] = [];

    // Cached value spans — updated cheaply without rebuilding the panel HTML.
    private _spPX:   HTMLSpanElement | null = null;
    private _spPY:   HTMLSpanElement | null = null;
    private _spPZ:   HTMLSpanElement | null = null;
    private _spRY:   HTMLSpanElement | null = null;
    private _spS:    HTMLSpanElement | null = null;
    private _spIncr: HTMLSpanElement | null = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    init(): void {
        // Auto-start calibration the first time XR becomes active.
        this.cleanupFuncs.push(
            this.world.visibilityState.subscribe((state) => {
                if (state === VisibilityState.Visible && this.state === 'idle') {
                    this.state = 'prompt_left';
                    this.updatePanel();
                }
            }),
        );

        // Expose a recalibrate hook so UI buttons can restart the flow.
        this.world.globals.recalibrate = () => {
            if (this.state === 'done') {
                this.clearFtButtons();
                this.state = 'prompt_left';
                this.updatePanel();
            }
        };
    }

    update(_delta: number, _time: number): void {
        if (this.state === 'idle' || this.state === 'done') return;

        // Either controller's trigger advances the calibration step.
        const triggerDown =
            this.input.gamepads.right?.getButtonDown(InputComponent.Trigger) ||
            this.input.gamepads.left?.getButtonDown(InputComponent.Trigger);
        if (!triggerDown) return;

        // ── Step 3: look direction → apply calibration → show fine-tune UI ────
        if (this.state === 'prompt_look') {
            const headObj = this.player.head as unknown as THREE.Object3D;
            headObj.updateMatrixWorld();

            // Head's local -Z axis in world space = direction the player is looking.
            // Project to horizontal so vertical head tilt doesn't affect the result.
            this.headLookDir
                .set(0, 0, -1)
                .transformDirection(headObj.matrixWorld)
                .setY(0)
                .normalize();

            this.applyCalibration();
            this.state = 'done';
            this.showFineTunePanel(); // builds HTML and caches span refs
            this.reapply();           // apply Z heuristic; also updates displayed values
            return;
        }

        // ── Steps 1 & 2: capture grip position ───────────────────────────────
        // A0 is on the LEFT side of the keyboard — user naturally reaches with
        // their left hand. C8 is on the RIGHT — right hand. Matching grip to
        // the expected hand is critical: always reading `right` meant step 1
        // captured the right controller hanging idle, not the left hand on A0.
        const isLeftStep = this.state === 'prompt_left';
        const gripSpace = isLeftStep
            ? (this.player.gripSpaces.left  ?? this.player.gripSpaces.right)
            : (this.player.gripSpaces.right ?? this.player.gripSpaces.left);
        if (!gripSpace) return;

        (gripSpace as unknown as THREE.Object3D).updateMatrixWorld();
        (gripSpace as unknown as THREE.Object3D).getWorldPosition(this.scratchPos);

        if (isLeftStep) {
            this.leftPoint.copy(this.scratchPos);
            this.state = 'prompt_right';
        } else {
            // prompt_right
            this.rightPoint.copy(this.scratchPos);
            this.state = 'prompt_look';
        }

        this.updatePanel();
    }

    // ── Anchor transform computation ──────────────────────────────────────────

    private applyCalibration(): void {
        const anchor = this.world.globals.anchor as THREE.Object3D | undefined;
        if (!anchor) return;

        // Physical midpoint between the two grip positions.
        const mid = new THREE.Vector3()
            .addVectors(this.leftPoint, this.rightPoint)
            .multiplyScalar(0.5);

        // Scale from the 88-key preset.  Using measured grip-to-grip was unreliable
        // (grip center ≠ key surface) — empirically off by 2.5× before the fix.
        const scale = PIANO_SCALE_88;

        const worldUp = new THREE.Vector3(0, 1, 0);

        // Piano's local +X axis: derived from head look direction (step 3).
        // headLookDir × worldUp gives the player's rightward direction = A0→C8.
        // Avoids ~22° error from using controller-to-controller vector.
        const rightVec = new THREE.Vector3()
            .crossVectors(this.headLookDir, worldUp)
            .normalize();

        // Piano's local +Z axis: perpendicular to rightVec, pointing FROM piano
        // TOWARD player so notes scroll toward the viewer.
        const forward = new THREE.Vector3().crossVectors(worldUp, rightVec).negate();

        // Build rotation: columns = local X, Y, Z axes in world space.
        const matrix = new THREE.Matrix4().makeBasis(rightVec, worldUp, forward);
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

        // Position the anchor so that local X=LOCAL_MID_X (midpoint between
        // A0-center=2 and C8-center=410) lands on the physical grip midpoint.
        const anchorPos = mid.clone().addScaledVector(rightVec, -LOCAL_MID_X * scale);

        anchor.position.copy(anchorPos);
        anchor.quaternion.copy(quaternion);
        anchor.scale.setScalar(scale);

        // Store calibrated baseline for fine-tuning. Reset all offsets.
        // _calMid is the physical midpoint — rotation pivots around it.
        this._calMid.copy(mid);
        this._calQuat.copy(quaternion);
        this._calScale = scale;
        this._ftPX = 0; this._ftPY = 0;
        // Z heuristic: the controller grip space sits slightly closer to the player
        // than the actual key surface (arm angle, grip body offset).  Empirically
        // ~5 cm on a standard piano with the correct-hand calibration flow.
        this._ftPZ = -0.05;
        this._ftRY = 0;
        this._ftS  = 1;
    }

    // ── Fine-tune panel ───────────────────────────────────────────────────────

    private showFineTunePanel(): void {
        const uiPanel = this.world.globals.uiPanel as HTMLDivElement | undefined;
        if (!uiPanel) return;

        const btn  = 'background:#3a3a7a;color:#e8e8e8;border:none;border-radius:4px;' +
                     'padding:2px 7px;cursor:pointer;font-size:11px;margin:1px';
        const btnP = 'background:#3a5a3a;color:#e8e8e8;border:none;border-radius:4px;' +
                     'padding:2px 10px;cursor:pointer;font-size:11px;margin:1px';

        uiPanel.innerHTML = `
            <div style="padding:10px;font-family:sans-serif;color:#e8e8e8;font-size:11px">
                <div style="display:flex;gap:4px;margin-bottom:8px">

                    <div style="flex:1;text-align:center">
                        <div style="font-weight:bold;margin-bottom:5px;font-size:12px">POSITION (m)</div>
                        <div style="margin-bottom:3px">
                            X <button id="ft-pxm" style="${btn}">-</button>
                            <span id="ft-px-val" style="display:inline-block;width:40px;text-align:center">0.000</span>
                            <button id="ft-pxp" style="${btn}">+</button>
                        </div>
                        <div style="margin-bottom:3px">
                            Y <button id="ft-pym" style="${btn}">-</button>
                            <span id="ft-py-val" style="display:inline-block;width:40px;text-align:center">0.000</span>
                            <button id="ft-pyp" style="${btn}">+</button>
                        </div>
                        <div>
                            Z <button id="ft-pzm" style="${btn}">-</button>
                            <span id="ft-pz-val" style="display:inline-block;width:40px;text-align:center">0.000</span>
                            <button id="ft-pzp" style="${btn}">+</button>
                        </div>
                    </div>

                    <div style="flex:1;text-align:center">
                        <div style="font-weight:bold;margin-bottom:5px;font-size:12px">ROT Y (°)</div>
                        <div>
                            <button id="ft-rym" style="${btn}">-</button>
                            <span id="ft-ry-val" style="display:inline-block;width:36px;text-align:center">0.0</span>
                            <button id="ft-ryp" style="${btn}">+</button>
                        </div>
                    </div>

                    <div style="flex:1;text-align:center">
                        <div style="font-weight:bold;margin-bottom:5px;font-size:12px">SCALE</div>
                        <div>
                            <button id="ft-sm" style="${btn}">-</button>
                            <span id="ft-s-val" style="display:inline-block;width:36px;text-align:center">1.00</span>
                            <button id="ft-sp" style="${btn}">+</button>
                        </div>
                    </div>

                </div>
                <div style="border-top:1px solid #555;padding-top:7px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <span>Incr:</span>
                    <button id="ft-incrm" style="${btn}">-</button>
                    <span id="ft-incr-val" style="display:inline-block;width:36px;text-align:center">0.01</span>
                    <button id="ft-incrp" style="${btn}">+</button>
                    <button id="ft-print" style="${btnP}">Print</button>
                </div>
            </div>
        `;

        // Cache value spans for cheap in-place updates.
        this._spPX   = uiPanel.querySelector('#ft-px-val');
        this._spPY   = uiPanel.querySelector('#ft-py-val');
        this._spPZ   = uiPanel.querySelector('#ft-pz-val');
        this._spRY   = uiPanel.querySelector('#ft-ry-val');
        this._spS    = uiPanel.querySelector('#ft-s-val');
        this._spIncr = uiPanel.querySelector('#ft-incr-val');

        // Helper: register a button in both the local list and world.globals.xrButtons.
        const reg = (id: string, onClick: () => void): void => {
            const el = uiPanel.querySelector(`#${id}`) as HTMLButtonElement;
            const entry: XrButton = { el, onClick };
            this._ftButtons.push(entry);
        };

        const incr = () => INCR_STEPS[this._ftIncrIdx];

        reg('ft-pxm', () => { this._ftPX -= incr(); this.reapply(); });
        reg('ft-pxp', () => { this._ftPX += incr(); this.reapply(); });
        reg('ft-pym', () => { this._ftPY -= incr(); this.reapply(); });
        reg('ft-pyp', () => { this._ftPY += incr(); this.reapply(); });
        reg('ft-pzm', () => { this._ftPZ -= incr(); this.reapply(); });
        reg('ft-pzp', () => { this._ftPZ += incr(); this.reapply(); });
        reg('ft-rym', () => { this._ftRY -= incr(); this.reapply(); });
        reg('ft-ryp', () => { this._ftRY += incr(); this.reapply(); });
        reg('ft-sm',  () => { this._ftS  -= incr(); this.reapply(); });
        reg('ft-sp',  () => { this._ftS  += incr(); this.reapply(); });
        reg('ft-incrm', () => {
            this._ftIncrIdx = Math.max(0, this._ftIncrIdx - 1);
            this.refreshValues();
        });
        reg('ft-incrp', () => {
            this._ftIncrIdx = Math.min(INCR_STEPS.length - 1, this._ftIncrIdx + 1);
            this.refreshValues();
        });
        reg('ft-print', () => { this.printValues(); });

        // Push all fine-tune buttons into the global xrButtons list so
        // HighwaySystem's ray hit-test can fire them.
        const xrButtons = this.world.globals.xrButtons as XrButton[] | undefined;
        if (xrButtons) xrButtons.push(...this._ftButtons);
    }

    private reapply(): void {
        const anchor = this.world.globals.anchor as THREE.Object3D | undefined;
        if (!anchor) return;

        // Effective rotation: yaw offset (world Y) composed with calibrated rotation.
        const yawQ = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            THREE.MathUtils.degToRad(this._ftRY),
        );
        const effectiveQuat = yawQ.clone().multiply(this._calQuat);
        anchor.quaternion.copy(effectiveQuat);

        // Effective scale.
        const effectiveScale = this._calScale * this._ftS;
        anchor.scale.setScalar(effectiveScale);

        // Position: offset moves the piano center (_calMid) in the CURRENT
        // piano local space (effectiveQuat), so X/Y/Z buttons always feel
        // aligned to the piano as it visually appears after any rotation.
        const posOffset = new THREE.Vector3(this._ftPX, this._ftPY, this._ftPZ)
            .applyQuaternion(effectiveQuat);
        const effectiveMid = this._calMid.clone().add(posOffset);

        // Back-compute anchor position: local X=LOCAL_MID_X maps to effectiveMid.
        // Rotation therefore pivots around the piano center, not the A0 corner.
        const midOffsetWorld = new THREE.Vector3(LOCAL_MID_X * effectiveScale, 0, 0)
            .applyQuaternion(effectiveQuat);
        anchor.position.copy(effectiveMid).sub(midOffsetWorld);

        this.refreshValues();
    }

    private refreshValues(): void {
        if (this._spPX)   this._spPX.textContent   = this._ftPX.toFixed(3);
        if (this._spPY)   this._spPY.textContent   = this._ftPY.toFixed(3);
        if (this._spPZ)   this._spPZ.textContent   = this._ftPZ.toFixed(3);
        if (this._spRY)   this._spRY.textContent   = this._ftRY.toFixed(1);
        if (this._spS)    this._spS.textContent    = this._ftS.toFixed(3);
        if (this._spIncr) this._spIncr.textContent = String(INCR_STEPS[this._ftIncrIdx]);
    }

    private printValues(): void {
        const anchor = this.world.globals.anchor as THREE.Object3D | undefined;
        if (!anchor) return;
        const p = anchor.position;
        const q = anchor.quaternion;
        console.log('[Calib:Print] anchor.position   =',
            `(${p.x.toFixed(5)}, ${p.y.toFixed(5)}, ${p.z.toFixed(5)})`);
        console.log('[Calib:Print] anchor.quaternion =',
            `(${q.x.toFixed(5)}, ${q.y.toFixed(5)}, ${q.z.toFixed(5)}, ${q.w.toFixed(5)})`);
        console.log('[Calib:Print] anchor.scale      =', anchor.scale.x.toFixed(7));
        console.log('[Calib:Print] fine-tune offsets: posLocal=(',
            `${this._ftPX.toFixed(3)}, ${this._ftPY.toFixed(3)}, ${this._ftPZ.toFixed(3)})`,
            `rotY=${this._ftRY.toFixed(2)}° scaleMul=${this._ftS.toFixed(4)}`);
    }

    private clearFtButtons(): void {
        const xrButtons = this.world.globals.xrButtons as XrButton[] | undefined;
        if (xrButtons) {
            for (const btn of this._ftButtons) {
                const idx = xrButtons.indexOf(btn);
                if (idx >= 0) xrButtons.splice(idx, 1);
            }
        }
        this._ftButtons = [];
        this._spPX = this._spPY = this._spPZ = this._spRY = this._spS = this._spIncr = null;
    }

    // ── Calibration step panel ────────────────────────────────────────────────

    private updatePanel(): void {
        const uiPanel = this.world.globals.uiPanel as HTMLDivElement | undefined;
        if (!uiPanel) return;

        const messages: Record<CalibrationState, string> = {
            idle:         '',
            prompt_left:  '🎹 Step 1 of 3<br><br>Rest your <b>LEFT controller</b><br>on the leftmost key <b>(A0)</b><br>and pull the left trigger.',
            prompt_right: '🎹 Step 2 of 3<br><br>Left key recorded ✓<br>Rest your <b>RIGHT controller</b><br>on the rightmost key <b>(C8)</b><br>and pull the right trigger.',
            prompt_look:  '🎹 Step 3 of 3<br><br>Sit at your piano and<br><b>look directly forward</b>, then pull the trigger.',
            done:         '',  // fine-tune panel takes over
        };

        uiPanel.innerHTML = `
            <div style="font-size:15px;line-height:1.7;padding:24px;color:#e8e8e8;text-align:center">
                ${messages[this.state]}
            </div>
        `;
    }
}
