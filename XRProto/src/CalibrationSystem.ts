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

type CalibrationState = 'idle' | 'prompt_left' | 'prompt_right' | 'done';

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

    // ── Full Reposition state ─────────────────────────────────────────────────

    // True while the user is partway through a Full Reposition from the fine-tune panel.
    // Keeps the fine-tune controls visible but disabled until both steps complete.
    private _fullRepositionInProgress = false;

    // Deferred fine-tune panel render: showFineTunePanel() is scheduled for the
    // NEXT frame instead of the frame where step 2 is confirmed. This prevents
    // HighwaySystem from clicking ft-restart on the same frame that CalibrationSystem
    // consumes the right trigger for the step-2 confirm (both read getButtonDown).
    private _pendingFineTunePanel = false;

    // ── Hand-tracking pinch state ─────────────────────────────────────────────

    private _leftWasPinching  = false;
    private _rightWasPinching = false;

    // ── Controller mode tracking ──────────────────────────────────────────────

    // Updated at the top of each update() call so panel messages stay consistent.
    private _hasControllers = true;

    // ── Fine-tune panel ───────────────────────────────────────────────────────

    private _ftButtons: XrButton[] = [];
    private _spPX:   HTMLElement | null = null;
    private _spPY:   HTMLElement | null = null;
    private _spPZ:   HTMLElement | null = null;
    private _spRY:   HTMLElement | null = null;
    private _spS:    HTMLElement | null = null;
    private _spIncr: HTMLElement | null = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    init(): void {
        // Expose on-demand start hook. Called by XRPreScene when the user
        // selects a Keys part and presses Play. onComplete fires after "Done".
        this.world.globals.startCalibration = (onComplete: () => void): void => {
            this._onComplete = onComplete;
            this.clearFtButtons();
            this.state = 'prompt_left';
            this.setHighwayVisible(false);
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
        // Opens fine-tune directly; user can trigger full reposition from there.
        this.world.globals.recalibrate = (onComplete: () => void): void => {
            this._onComplete = onComplete;
            this.state = 'done';
            this.showFineTunePanel();
            this.reapply();
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
        // Deferred from step-2 completion — show panel one frame after the confirm
        // so HighwaySystem can't click ft-restart with the same getButtonDown tick.
        if (this._pendingFineTunePanel) {
            this._pendingFineTunePanel = false;
            this.showFineTunePanel();
        }

        if (this.state === 'idle' || this.state === 'done') return;

        // hasHandInputSources() is the reliable signal — IWSDK may keep gamepad
        // objects alive even when the user is in hand-tracking mode.
        this._hasControllers = !this.hasHandInputSources();

        const leftConfirm  = this.confirmDown('left');
        const rightConfirm = this.confirmDown('right');
        const anyConfirm   = leftConfirm || rightConfirm;
        if (!anyConfirm) return;

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
            if (this._fullRepositionInProgress) {
                // Keep fine-tune panel visible with updated step message and values.
                this.showFineTunePanel();
                this.refreshValues();
            } else {
                this.updatePanel();
            }
        } else {
            this.rightPoint.copy(this.scratchPos);
            // Forward is derived from the perpendicular to the L-R line — no step 3 needed.
            this.applyCalibration();
            this.state = 'done';
            this._fullRepositionInProgress = false;
            this.setHighwayVisible(true);
            this.reapply();
            // Defer panel render to next frame — prevents HighwaySystem from clicking
            // ft-restart on the same frame that this trigger confirm is processed.
            this._pendingFineTunePanel = true;
        }
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

        // Piano's local +X axis: A0 → C8 direction projected onto XZ plane.
        const rightVec = new THREE.Vector3()
            .subVectors(this.rightPoint, this.leftPoint)
            .setY(0)
            .normalize();

        // Piano's local +Z axis: perpendicular to rightVec in XZ plane, toward the user.
        // Two candidates — pick the one with a positive dot product against head position.
        const headPos = new THREE.Vector3();
        (this.player.head as unknown as THREE.Object3D).updateMatrixWorld();
        (this.player.head as unknown as THREE.Object3D).getWorldPosition(headPos);
        const toHead = new THREE.Vector3().subVectors(headPos, mid).setY(0);
        const candidate = new THREE.Vector3(-rightVec.z, 0, rightVec.x);
        const forward = candidate.dot(toHead) >= 0 ? candidate : candidate.negate();

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

        // Always clear previously registered buttons before rebuilding.
        this.clearFtButtons();

        // Resize back to standard panel dimensions (e.g. coming from 1000×525 Library).
        (this.world.globals.resizePanel as ((w: number, h: number) => void) | undefined)?.(400, 300);

        if (this._fullRepositionInProgress) {
            // Show only the step instruction — no controls, no buttons.
            const ctrl = !this.hasHandInputSources();
            const stepMsg = this.state === 'prompt_left'
                ? (ctrl
                    ? '🎹 Step 1 of 2<br><br>Rest your <b>LEFT controller</b><br>on the <b>leftmost key</b><br>and pull the left trigger.'
                    : '🎹 Step 1 of 2<br><br>Touch the <b>leftmost key</b><br>with your <b>left index finger</b><br>and pinch to confirm.')
                : (ctrl
                    ? '🎹 Step 2 of 2<br><br>Rest your <b>RIGHT controller</b><br>on the <b>rightmost key</b><br>and pull the right trigger.'
                    : '🎹 Step 2 of 2<br><br>Touch the <b>rightmost key</b><br>with your <b>right index finger</b><br>and pinch to confirm.');

            uiPanel.innerHTML = `
                <div class="frame">
                    <div class="content" style="justify-content:center;align-items:center;">
                        <p style="font-size:15px;line-height:1.7;color:#e8e8e8;text-align:center;padding:24px">${stepMsg}</p>
                    </div>
                </div>
            `;
            // No buttons registered — nothing interactive during the reposition flow.
            return;
        }

        uiPanel.innerHTML = `
            <div class="frame">
                <div class="content">
                    <div class="header"></div>
                    <div class="controls">
                        <div class="section-row">
                            <div class="section">
                                <div class="section-label">
                                    <p class="section-title">Position</p>
                                </div>
                                <div class="axis-row">
                                    <p class="axis-label">X</p>
                                    <button id="ft-pxm" class="button secondary-dark" type="button">-</button>
                                    <p id="ft-px-val" class="value-display">0.000</p>
                                    <button id="ft-pxp" class="button secondary-dark" type="button">+</button>
                                </div>
                                <div class="axis-row">
                                    <p class="axis-label">Y</p>
                                    <button id="ft-pym" class="button secondary-dark" type="button">-</button>
                                    <p id="ft-py-val" class="value-display">0.000</p>
                                    <button id="ft-pyp" class="button secondary-dark" type="button">+</button>
                                </div>
                                <div class="axis-row">
                                    <p class="axis-label">Z</p>
                                    <button id="ft-pzm" class="button secondary-dark" type="button">-</button>
                                    <p id="ft-pz-val" class="value-display">0.000</p>
                                    <button id="ft-pzp" class="button secondary-dark" type="button">+</button>
                                </div>
                            </div>
                            <div class="section">
                                <div class="section-group">
                                    <div class="section-label">
                                        <p class="section-title">Rotation</p>
                                    </div>
                                    <div class="axis-row">
                                        <button id="ft-rym" class="button secondary-dark" type="button">-</button>
                                        <p id="ft-ry-val" class="value-display">0.0</p>
                                        <button id="ft-ryp" class="button secondary-dark" type="button">+</button>
                                    </div>
                                </div>
                                <div class="section-group">
                                    <div class="section-label">
                                        <p class="section-title">Scale</p>
                                    </div>
                                    <div class="axis-row">
                                        <button id="ft-sm" class="button secondary-dark" type="button">-</button>
                                        <p id="ft-s-val" class="value-display">1.000</p>
                                        <button id="ft-sp" class="button secondary-dark" type="button">+</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="section">
                            <div class="section-group">
                                <div class="section-label">
                                    <p class="section-title">Increment</p>
                                </div>
                                <div class="axis-row">
                                    <button id="ft-incrm" class="button secondary-dark" type="button">-</button>
                                    <p id="ft-incr-val" class="value-display">0.01</p>
                                    <button id="ft-incrp" class="button secondary-dark" type="button">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="actions">
                    <button id="ft-restart" class="button primary-dark" type="button">🔄 Full Reposition</button>
                    <button id="ft-done" class="button primary-light" type="button">▶ Play</button>
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
            const el = uiPanel.querySelector(`#${id}`) as HTMLButtonElement | null;
            if (!el) return;
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
        reg('ft-restart', () => {
            // Return to step 1 without clearing _onComplete — the original
            // done() callback fires after the redo completes.
            this._fullRepositionInProgress = true;
            this.state = 'prompt_left';
            this.setHighwayVisible(false);
            this.showFineTunePanel();
        });
        reg('ft-done', () => {
            this.saveCalibration();
            this._onComplete?.();
            this._onComplete = null;
        });

        const xrButtons = this.world.globals.xrButtons as XrButton[] | undefined;
        if (xrButtons) xrButtons.push(...this._ftButtons);
    }

    private setHighwayVisible(visible: boolean): void {
        const anchor = this.world.globals.anchor as THREE.Object3D | undefined;
        if (anchor) anchor.visible = visible;
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
                ? '🎹 Step 1 of 2<br><br>Rest your <b>LEFT controller</b><br>on the <b>leftmost key</b><br>and pull the left trigger.'
                : '🎹 Step 1 of 2<br><br>Touch the <b>leftmost key</b><br>with your <b>left index finger</b><br>and pinch to confirm.',
            prompt_right: ctrl
                ? '🎹 Step 2 of 2<br><br>Rest your <b>RIGHT controller</b><br>on the <b>rightmost key</b><br>and pull the right trigger.'
                : '🎹 Step 2 of 2<br><br>Touch the <b>rightmost key</b><br>with your <b>right index finger</b><br>and pinch to confirm.',
        };

        uiPanel.innerHTML = `
            <div style="font-size:15px;line-height:1.7;padding:24px;color:#e8e8e8;text-align:center">
                ${messages[this.state]}
            </div>
        `;
    }
}
