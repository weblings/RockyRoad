import * as THREE from "three";
import { createSystem, InputComponent } from "@iwsdk/core";
import type { XrButton } from "./XRTypes.js";

// ── CalibrationPointer interface ──────────────────────────────────────────────
//
// Documents the abstraction used during calibration steps 1 & 2.
// Controller and hand-tracking paths implement this contract via the private
// helper methods confirmDown() / tipPosition() below.

export interface CalibrationPointer {
    /** Writes the current pointer world position into `target`. Returns false if unavailable. */
    getWorldPosition(target: THREE.Vector3): boolean;
    /** True on the frame the confirm gesture fires (trigger down / pinch start). */
    isConfirmDown(): boolean;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CalibrationState = 'idle' | 'prompt_left' | 'prompt_right' | 'prompt_look' | 'done';

// ── Constants ─────────────────────────────────────────────────────────────────

// Center of A0 (key 21) to center of C8 (key 108) in KeysPlayerScene3D world
// units with minKey=21. Verified: (getKeyPos(21)+getKeyPos(22))/2 = 2,
// (getKeyPos(108)+getKeyPos(109))/2 = 410, distance = 408.
const HIGHWAY_CENTER_TO_CENTER_UNITS = 408;

// Local X coordinate of the midpoint between A0-center and C8-center.
const LOCAL_MID_X = 206;

// Standard 88-key piano: A0-center to C8-center ≈ 1.186 m.
// Derived from confirmed-good calibration: scale 0.0029070 × 408 = 1.186 m.
const PIANO_SCALE_88 = 1.186 / HIGHWAY_CENTER_TO_CENTER_UNITS; // ≈ 0.002907

// Increment values cycled by the Incr [-][+] buttons.
const INCR_STEPS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0];

// localStorage key for persisted calibration.
const CAL_STORAGE_KEY = 'xr-calibration';

// Pinch threshold in metres (squared for cheap distance check).
const PINCH_THRESHOLD_SQ = 0.020 * 0.020; // 20 mm

// ── CalibrationSystem ─────────────────────────────────────────────────────────

export class CalibrationSystem extends createSystem({}) {
    private state: CalibrationState = 'idle';

    // Callback fired when the user presses "Done" in the fine-tune panel.
    // Set by the startCalibration() global hook.
    private _onComplete: (() => void) | null = null;

    // Steps 1 & 2: tip positions at A0 and C8.
    private leftPoint  = new THREE.Vector3();
    private rightPoint = new THREE.Vector3();
    private scratchPos = new THREE.Vector3();

    // Step 3: head look direction captured while the player faces the piano.
    private headLookDir = new THREE.Vector3();

    // ── Fine-tune state ───────────────────────────────────────────────────────

    private _calMid   = new THREE.Vector3();
    private _calQuat  = new THREE.Quaternion();
    private _calScale = 1;

    private _ftPX = 0;
    private _ftPY = 0;
    private _ftPZ = 0;
    private _ftRY = 0;
    private _ftS  = 1;
    private _ftIncrIdx = 4; // starts at 0.1 m

    // ── Hand-tracking pinch state ─────────────────────────────────────────────

    private _leftWasPinching  = false;
    private _rightWasPinching = false;

    // ── Controller mode tracking ──────────────────────────────────────────────

    // Updated at the top of each update() call so panel messages stay consistent.
    private _hasControllers = true;

    // ── Fine-tune panel ───────────────────────────────────────────────────────

    private _ftButtons: XrButton[] = [];
    private _spPX:   HTMLSpanElement | null = null;
    private _spPY:   HTMLSpanElement | null = null;
    private _spPZ:   HTMLSpanElement | null = null;
    private _spRY:   HTMLSpanElement | null = null;
    private _spS:    HTMLSpanElement | null = null;
    private _spIncr: HTMLSpanElement | null = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    init(): void {
        // Expose on-demand start hook. Called by XRPreScene when the user
        // selects a Keys part and presses Play. onComplete fires after "Done".
        this.world.globals.startCalibration = (onComplete: () => void): void => {
            this._onComplete = onComplete;
            this.clearFtButtons();
            this.state = 'prompt_left';
            this.updatePanel();
        };

        // Expose a load-saved-calibration hook. Returns true if a saved
        // calibration was found and applied; false if a fresh run is needed.
        this.world.globals.tryLoadCalibration = (): boolean => {
            if (!this.loadCalibration()) return false;
            this.reapply();
            return true;
        };

        // Expose a recalibrate hook (used by XRActiveScene's Recalibrate button).
        this.world.globals.recalibrate = (onComplete: () => void): void => {
            this._onComplete = onComplete;
            this.clearFtButtons();
            this.state = 'prompt_left';
            this.updatePanel();
        };

        // Expose the fine-tune panel so XRPreScene can show it after auto-loading
        // a saved calibration (user can adjust before pressing Play).
        this.world.globals.showCalibrationFineTune = (onComplete: () => void): void => {
            this._onComplete = onComplete;
            this.state = 'done';
            this.showFineTunePanel();
            this.reapply();
        };
    }

    update(_delta: number, _time: number): void {
        if (this.state === 'idle' || this.state === 'done') return;

        // hasHandInputSources() is the reliable signal — IWSDK may keep gamepad
        // objects alive even when the user is in hand-tracking mode.
        this._hasControllers = !this.hasHandInputSources();

        const leftConfirm  = this.confirmDown('left');
        const rightConfirm = this.confirmDown('right');
        const anyConfirm   = leftConfirm || rightConfirm;
        if (!anyConfirm) return;

        // ── Step 3: look direction → apply calibration → show fine-tune UI ────
        if (this.state === 'prompt_look') {
            const headObj = this.player.head as unknown as THREE.Object3D;
            headObj.updateMatrixWorld();
            this.headLookDir
                .set(0, 0, -1)
                .transformDirection(headObj.matrixWorld)
                .setY(0)
                .normalize();

            this.applyCalibration();
            this.state = 'done';
            this.showFineTunePanel();
            this.reapply();
            return;
        }

        // ── Steps 1 & 2: capture tip position ────────────────────────────────
        // A0 is on the LEFT side — left hand/controller.
        // C8 is on the RIGHT side — right hand/controller.
        const isLeftStep = this.state === 'prompt_left';
        if (!(isLeftStep ? leftConfirm : rightConfirm)) return;

        const gotPos = this.tipPosition(isLeftStep ? 'left' : 'right', this.scratchPos);
        if (!gotPos) return;

        if (isLeftStep) {
            this.leftPoint.copy(this.scratchPos);
            this.state = 'prompt_right';
        } else {
            this.rightPoint.copy(this.scratchPos);
            this.state = 'prompt_look';
        }
        this.updatePanel();
    }

    // ── Input helpers: controller + hand tracking ─────────────────────────────

    /** True on the frame the confirm gesture just fired for the given side. */
    private confirmDown(side: 'left' | 'right'): boolean {
        if (this._hasControllers) {
            const pad = side === 'left' ? this.input.gamepads.left : this.input.gamepads.right;
            return pad?.getButtonDown(InputComponent.Trigger) ?? false;
        }
        return this.handPinchDown(side);
    }

    /** Pinch leading-edge detection (fires once on pinch start). */
    private handPinchDown(side: 'left' | 'right'): boolean {
        const isPinching = this.handIsPinching(side);
        if (side === 'left') {
            const was = this._leftWasPinching;
            this._leftWasPinching = isPinching;
            return isPinching && !was;
        } else {
            const was = this._rightWasPinching;
            this._rightWasPinching = isPinching;
            return isPinching && !was;
        }
    }

    /** True if the XR session has at least one hand-tracked input source.
     *  More reliable than checking gamepads — IWSDK may keep gamepad objects
     *  alive even when the user switches to hand tracking mode. */
    private hasHandInputSources(): boolean {
        const renderer = this.world.renderer as unknown as THREE.WebGLRenderer;
        const session  = renderer.xr.getSession() as XRSession | null;
        if (!session) return false;
        for (const source of session.inputSources) {
            if ((source as unknown as { hand?: XRHand }).hand != null) return true;
        }
        return false;
    }

    /** Returns whether the given hand is currently pinching (thumb-tip ↔ index-tip < 20 mm). */
    private handIsPinching(side: 'left' | 'right'): boolean {
        const renderer = this.world.renderer as unknown as THREE.WebGLRenderer;
        const frame    = renderer.xr.getFrame() as XRFrame | null;
        const refSpace = renderer.xr.getReferenceSpace() as XRReferenceSpace | null;
        const session  = renderer.xr.getSession() as XRSession | null;
        if (!frame || !refSpace || !session) return false;

        for (const source of session.inputSources) {
            if (source.handedness !== side) continue;
            const hand = (source as unknown as { hand?: XRHand }).hand;
            if (!hand) return false;

            const thumbJoint = hand.get('thumb-tip');
            const indexJoint = hand.get('index-finger-tip');
            if (!thumbJoint || !indexJoint) return false;

            // XRFrame.getJointPose is part of the WebXR Hand Input spec.
            const thumbPose = (frame as unknown as XRFrame & { getJointPose(j: XRJointSpace, r: XRSpace): XRJointPose | null })
                .getJointPose(thumbJoint, refSpace);
            const indexPose = (frame as unknown as XRFrame & { getJointPose(j: XRJointSpace, r: XRSpace): XRJointPose | null })
                .getJointPose(indexJoint, refSpace);
            if (!thumbPose || !indexPose) return false;

            const t = thumbPose.transform.position;
            const i = indexPose.transform.position;
            const dx = t.x - i.x, dy = t.y - i.y, dz = t.z - i.z;
            return dx * dx + dy * dy + dz * dz < PINCH_THRESHOLD_SQ;
        }
        return false;
    }

    /** Writes the tip world position for the given side into `target`. */
    private tipPosition(side: 'left' | 'right', target: THREE.Vector3): boolean {
        if (this._hasControllers) {
            const gripSpace = side === 'left'
                ? (this.player.gripSpaces.left  ?? this.player.gripSpaces.right)
                : (this.player.gripSpaces.right ?? this.player.gripSpaces.left);
            if (!gripSpace) return false;
            (gripSpace as unknown as THREE.Object3D).updateMatrixWorld();
            (gripSpace as unknown as THREE.Object3D).getWorldPosition(target);
            return true;
        }
        return this.handTipPosition(side, target);
    }

    /** Reads the index-finger-tip joint position into `target`. */
    private handTipPosition(side: 'left' | 'right', target: THREE.Vector3): boolean {
        const renderer = this.world.renderer as unknown as THREE.WebGLRenderer;
        const frame    = renderer.xr.getFrame() as XRFrame | null;
        const refSpace = renderer.xr.getReferenceSpace() as XRReferenceSpace | null;
        const session  = renderer.xr.getSession() as XRSession | null;
        if (!frame || !refSpace || !session) return false;

        for (const source of session.inputSources) {
            if (source.handedness !== side) continue;
            const hand = (source as unknown as { hand?: XRHand }).hand;
            if (!hand) return false;
            const joint = hand.get('index-finger-tip');
            if (!joint) return false;
            const pose = (frame as unknown as XRFrame & { getJointPose(j: XRJointSpace, r: XRSpace): XRJointPose | null })
                .getJointPose(joint, refSpace);
            if (!pose) return false;
            const p = pose.transform.position;
            target.set(p.x, p.y, p.z);
            return true;
        }
        return false;
    }

    // ── Anchor transform computation ──────────────────────────────────────────

    private applyCalibration(): void {
        const anchor = this.world.globals.anchor as THREE.Object3D | undefined;
        if (!anchor) return;

        const mid = new THREE.Vector3()
            .addVectors(this.leftPoint, this.rightPoint)
            .multiplyScalar(0.5);

        // Scale from the 88-key preset. Using measured grip-to-grip was unreliable
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

        const matrix = new THREE.Matrix4().makeBasis(rightVec, worldUp, forward);
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

        const anchorPos = mid.clone().addScaledVector(rightVec, -LOCAL_MID_X * scale);

        anchor.position.copy(anchorPos);
        anchor.quaternion.copy(quaternion);
        anchor.scale.setScalar(scale);

        this._calMid.copy(mid);
        this._calQuat.copy(quaternion);
        this._calScale = scale;
        this._ftPX = 0; this._ftPY = 0;
        // Z heuristic: grip/finger sits slightly shallower than the key surface.
        this._ftPZ = -0.05;
        this._ftRY = 0;
        this._ftS  = 1;
    }

    // ── Calibration persistence ───────────────────────────────────────────────

    private saveCalibration(): void {
        const data = {
            calMid:   [this._calMid.x,   this._calMid.y,   this._calMid.z],
            calQuat:  [this._calQuat.x,  this._calQuat.y,  this._calQuat.z, this._calQuat.w],
            calScale: this._calScale,
            ftPX: this._ftPX, ftPY: this._ftPY, ftPZ: this._ftPZ,
            ftRY: this._ftRY, ftS:  this._ftS,
        };
        try {
            localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify(data));
        } catch {
            console.warn('[Calib] Could not save calibration to localStorage.');
        }
    }

    private loadCalibration(): boolean {
        try {
            const raw = localStorage.getItem(CAL_STORAGE_KEY);
            if (!raw) return false;
            const d = JSON.parse(raw) as {
                calMid: number[]; calQuat: number[]; calScale: number;
                ftPX: number; ftPY: number; ftPZ: number; ftRY: number; ftS: number;
            };
            this._calMid.set(d.calMid[0], d.calMid[1], d.calMid[2]);
            this._calQuat.set(d.calQuat[0], d.calQuat[1], d.calQuat[2], d.calQuat[3]);
            this._calScale = d.calScale;
            this._ftPX = d.ftPX; this._ftPY = d.ftPY; this._ftPZ = d.ftPZ;
            this._ftRY = d.ftRY; this._ftS  = d.ftS;
            return true;
        } catch {
            return false;
        }
    }

    // ── Fine-tune panel ───────────────────────────────────────────────────────

    private showFineTunePanel(): void {
        const uiPanel = this.world.globals.uiPanel as HTMLDivElement | undefined;
        if (!uiPanel) return;

        const btn  = 'background:#3a3a7a;color:#e8e8e8;border:none;border-radius:4px;' +
                     'padding:2px 7px;cursor:pointer;font-size:11px;margin:1px';
        const btnP = 'background:#3a5a3a;color:#e8e8e8;border:none;border-radius:4px;' +
                     'padding:2px 10px;cursor:pointer;font-size:11px;margin:1px';
        const btnD = 'background:#5a3a7a;color:#e8e8e8;border:none;border-radius:4px;' +
                     'padding:4px 12px;cursor:pointer;font-size:12px;margin:1px';

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
                    <button id="ft-print"   style="${btnP}">Print</button>
                    <button id="ft-restart" style="${btnP}">↺ Restart</button>
                    <button id="ft-done"    style="${btnD}">✓ Done</button>
                </div>
            </div>
        `;

        this._spPX   = uiPanel.querySelector('#ft-px-val');
        this._spPY   = uiPanel.querySelector('#ft-py-val');
        this._spPZ   = uiPanel.querySelector('#ft-pz-val');
        this._spRY   = uiPanel.querySelector('#ft-ry-val');
        this._spS    = uiPanel.querySelector('#ft-s-val');
        this._spIncr = uiPanel.querySelector('#ft-incr-val');

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
        reg('ft-print',   () => { this.printValues(); });
        reg('ft-restart', () => {
            // Return to step 1 without clearing _onComplete — the original
            // done() callback (e.g. showActiveScene) still fires after the redo.
            this.clearFtButtons();
            this.state = 'prompt_left';
            this.updatePanel();
        });
        reg('ft-done',  () => {
            this.saveCalibration();
            this._onComplete?.();
            this._onComplete = null;
        });

        const xrButtons = this.world.globals.xrButtons as XrButton[] | undefined;
        if (xrButtons) xrButtons.push(...this._ftButtons);
    }

    private reapply(): void {
        const anchor = this.world.globals.anchor as THREE.Object3D | undefined;
        if (!anchor) return;

        const yawQ = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            THREE.MathUtils.degToRad(this._ftRY),
        );
        const effectiveQuat = yawQ.clone().multiply(this._calQuat);
        anchor.quaternion.copy(effectiveQuat);

        const effectiveScale = this._calScale * this._ftS;
        anchor.scale.setScalar(effectiveScale);

        const posOffset = new THREE.Vector3(this._ftPX, this._ftPY, this._ftPZ)
            .applyQuaternion(effectiveQuat);
        const effectiveMid = this._calMid.clone().add(posOffset);

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

        // Compute fresh each call — _hasControllers may not be set yet on the
        // first call (startCalibration fires synchronously before update() runs).
        const ctrl = !this.hasHandInputSources();
        const messages: Record<CalibrationState, string> = {
            idle:  '',
            done:  '',
            prompt_left: ctrl
                ? '🎹 Step 1 of 3<br><br>Rest your <b>LEFT controller</b><br>on the leftmost key <b>(A0)</b><br>and pull the left trigger.'
                : '🎹 Step 1 of 3<br><br>Touch the leftmost key <b>(A0)</b><br>with your <b>left index finger</b><br>and pinch to confirm.',
            prompt_right: ctrl
                ? '🎹 Step 2 of 3<br><br>Left key recorded ✓<br>Rest your <b>RIGHT controller</b><br>on the rightmost key <b>(C8)</b><br>and pull the right trigger.'
                : '🎹 Step 2 of 3<br><br>Left key recorded ✓<br>Touch the rightmost key <b>(C8)</b><br>with your <b>right index finger</b><br>and pinch to confirm.',
            prompt_look: ctrl
                ? '🎹 Step 3 of 3<br><br>Sit at your piano and<br><b>look directly forward</b>, then pull the trigger.'
                : '🎹 Step 3 of 3<br><br>Sit at your piano and<br><b>look directly forward</b>, then pinch to confirm.',
        };

        uiPanel.innerHTML = `
            <div style="font-size:15px;line-height:1.7;padding:24px;color:#e8e8e8;text-align:center">
                ${messages[this.state]}
            </div>
        `;
    }
}
