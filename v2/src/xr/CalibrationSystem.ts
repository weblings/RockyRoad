import * as THREE from "three";
import { createSystem, InputComponent } from "@iwsdk/core";
import type { XrButton } from "./XRTypes";

// ── CalibrationPointer interface ──────────────────────────────────────────────

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

const LOCAL_MID_X = 206;

// Standard 88-key piano: A0-center to C8-center ≈ 1.186 m.
const PIANO_SCALE_88 = 1.186 / HIGHWAY_CENTER_TO_CENTER_UNITS; // ≈ 0.002907

const INCR_STEPS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0];

const CAL_STORAGE_KEY = 'xr-calibration';

const PINCH_THRESHOLD_SQ = 0.020 * 0.020; // 20 mm

// Guitar/Bass — no physical instrument to size-match against, so scale is a fixed
// default rather than derived from a two-point touch. Reuses the piano's per-unit
// scale so a full 24-fret neck (getFretPosition(24) = 225 units) lands at a
// real-guitar-plausible ~0.65m.
const GUITAR_SCALE_DEFAULT = PIANO_SCALE_88;

const GUITAR_CAL_STORAGE_KEY = 'xr-guitar-calibration';

// How far in front of the head (along raw, unflattened camera-forward) the
// guitar volume is auto-placed on first calibration.
const GUITAR_PLACEMENT_DISTANCE = 1.0;

// ── CalibrationSystem ─────────────────────────────────────────────────────────

export class CalibrationSystem extends createSystem({}) {
    private state: CalibrationState = 'idle';

    private _onComplete: (() => void) | null = null;

    private leftPoint  = new THREE.Vector3();
    private rightPoint = new THREE.Vector3();
    private scratchPos = new THREE.Vector3();

    private _calMid   = new THREE.Vector3();
    private _calQuat  = new THREE.Quaternion();
    private _calScale = 1;

    private _ftPX = 0;
    private _ftPY = 0;
    private _ftPZ = 0;
    private _ftRY = 0;
    private _ftS  = 1;
    private _ftIncrIdx = 4;

    private _fullRepositionInProgress = false;
    private _pendingFineTunePanel = false;

    private _leftWasPinching  = false;
    private _rightWasPinching = false;

    private _hasControllers = true;

    private _ftButtons: XrButton[] = [];
    private _spPX:   HTMLElement | null = null;
    private _spPY:   HTMLElement | null = null;
    private _spPZ:   HTMLElement | null = null;
    private _spRY:   HTMLElement | null = null;
    private _spS:    HTMLElement | null = null;
    private _spIncr: HTMLElement | null = null;

    init(): void {
        this.world.globals.startCalibration = (onComplete: () => void): void => {
            if (this.isGuitarActive()) {
                this.startGuitarCalibration(onComplete);
                return;
            }
            this._onComplete = onComplete;
            this.clearFtButtons();
            this.state = 'prompt_left';
            this.setHighwayVisible(false);
            this.updatePanel();
        };

        this.world.globals.tryLoadCalibration = (instrumentType: string): boolean => {
            if (instrumentType !== 'Keys') {
                if (!this.loadGuitarCalibration()) return false;
                this.setGuitarBarVisible(true);
                return true;
            }
            if (!this.loadCalibration()) return false;
            this.reapply();
            return true;
        };

        this.world.globals.recalibrate = (onComplete: () => void): void => {
            if (this.isGuitarActive()) {
                this._onComplete = onComplete;
                this.setGuitarBarVisible(true);
                this.showGuitarFineTunePanel();
                return;
            }
            this._onComplete = onComplete;
            this.state = 'done';
            this.showFineTunePanel();
            this.reapply();
        };

        this.world.globals.showCalibrationFineTune = (onComplete: () => void): void => {
            if (this.isGuitarActive()) {
                this._onComplete = onComplete;
                this.setGuitarBarVisible(true);
                this.showGuitarFineTunePanel();
                return;
            }
            this._onComplete = onComplete;
            this.state = 'done';
            this.showFineTunePanel();
            this.reapply();
        };
    }

    update(_delta: number, _time: number): void {
        if (this._pendingFineTunePanel) {
            this._pendingFineTunePanel = false;
            this.showFineTunePanel();
        }

        if (this.state === 'idle' || this.state === 'done') return;

        this._hasControllers = !this.hasHandInputSources();

        const leftConfirm  = this.confirmDown('left');
        const rightConfirm = this.confirmDown('right');
        const anyConfirm   = leftConfirm || rightConfirm;
        if (!anyConfirm) return;

        const isLeftStep = this.state === 'prompt_left';
        if (!(isLeftStep ? leftConfirm : rightConfirm)) return;

        const gotPos = this.tipPosition(isLeftStep ? 'left' : 'right', this.scratchPos);
        if (!gotPos) return;

        if (isLeftStep) {
            this.leftPoint.copy(this.scratchPos);
            this.state = 'prompt_right';
            if (this._fullRepositionInProgress) {
                this.showFineTunePanel();
                this.refreshValues();
            } else {
                this.updatePanel();
            }
        } else {
            this.rightPoint.copy(this.scratchPos);
            this.applyCalibration();
            this.state = 'done';
            this._fullRepositionInProgress = false;
            this.setHighwayVisible(true);
            this.reapply();
            this._pendingFineTunePanel = true;
        }
    }

    private confirmDown(side: 'left' | 'right'): boolean {
        if (this._hasControllers) {
            const pad = side === 'left' ? this.input.gamepads.left : this.input.gamepads.right;
            return pad?.getButtonDown(InputComponent.Trigger) ?? false;
        }
        return this.handPinchDown(side);
    }

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

    private hasHandInputSources(): boolean {
        const renderer = this.world.renderer as unknown as THREE.WebGLRenderer;
        const session  = renderer.xr.getSession() as XRSession | null;
        if (!session) return false;
        for (const source of session.inputSources) {
            if ((source as unknown as { hand?: XRHand }).hand != null) return true;
        }
        return false;
    }

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

    private applyCalibration(): void {
        const anchor = this.world.globals.anchor as THREE.Object3D | undefined;
        if (!anchor) return;

        const mid = new THREE.Vector3()
            .addVectors(this.leftPoint, this.rightPoint)
            .multiplyScalar(0.5);

        const scale = PIANO_SCALE_88;

        const worldUp = new THREE.Vector3(0, 1, 0);

        const rightVec = new THREE.Vector3()
            .subVectors(this.rightPoint, this.leftPoint)
            .setY(0)
            .normalize();

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
        this._ftPZ = -0.05;
        this._ftRY = 0;
        this._ftS  = 1;
    }

    // ── Guitar/Bass calibration ─────────────────────────────────────────────────
    // No physical instrument to touch-calibrate against, so placement is instant:
    // drop the volume one meter along raw camera-forward, facing back toward the
    // player, then let the grab bar (see HighwaySystem) handle repositioning.

    private isGuitarActive(): boolean {
        return (this.world.globals.currentPartType as string | undefined) !== 'Keys';
    }

    private guitarBar(): THREE.Object3D | undefined {
        return this.world.globals.guitarGrabBarHit as THREE.Object3D | undefined;
    }

    private guitarScaleNode(): THREE.Object3D | undefined {
        return this.world.globals.guitarScaleNode as THREE.Object3D | undefined;
    }

    private setGuitarBarVisible(visible: boolean): void {
        const bar = this.guitarBar();
        if (bar) bar.visible = visible;
    }

    private startGuitarCalibration(onComplete: () => void): void {
        this._onComplete = onComplete;
        this.clearFtButtons();
        this.placeGuitarBar();
        this.setGuitarBarVisible(true);
        this.showGuitarFineTunePanel();
    }

    private placeGuitarBar(): void {
        const bar = this.guitarBar();
        if (!bar) return;

        const head = this.player.head as unknown as THREE.Object3D;
        head.updateMatrixWorld();
        const headPos = new THREE.Vector3();
        head.getWorldPosition(headPos);
        // Object3D.getWorldDirection() returns the object's +Z world axis; heads/
        // cameras look down -Z, so negate to get the actual look direction.
        const forward = new THREE.Vector3();
        head.getWorldDirection(forward).negate();

        bar.position.copy(headPos).addScaledVector(forward, GUITAR_PLACEMENT_DISTANCE);
        bar.rotation.set(0, Math.atan2(headPos.x - bar.position.x, headPos.z - bar.position.z), 0);
        // Scale lives on guitarScaleNode, not the bar itself — the bar (and its
        // visual pill) must stay a constant physical size, same as the menu bar.
        const scaleNode = this.guitarScaleNode();
        if (scaleNode) scaleNode.scale.setScalar(GUITAR_SCALE_DEFAULT);
    }

    private showGuitarFineTunePanel(): void {
        const uiPanel = this.world.globals.uiPanel as HTMLDivElement | undefined;
        if (!uiPanel) return;

        this.clearFtButtons();
        (this.world.globals.resizePanel as ((w: number, h: number) => void) | undefined)?.(400, 300);

        uiPanel.innerHTML = `
            <div class="frame">
                <div class="content" style="justify-content:center;align-items:center;">
                    <p style="font-size:15px;line-height:1.7;color:#e8e8e8;text-align:center;padding:24px">
                        🎸 Grab the bar below the fretboard<br>to reposition it.
                    </p>
                </div>
                <div class="actions">
                    <button id="ft-guitar-done" class="button primary-light icon-btn" type="button"><span>Done</span></button>
                </div>
            </div>
        `;

        const el = uiPanel.querySelector('#ft-guitar-done') as HTMLButtonElement | null;
        if (!el) return;

        const entry: XrButton = {
            el,
            onClick: () => {
                this.saveGuitarCalibration();
                this._onComplete?.();
                this._onComplete = null;
            },
        };
        this._ftButtons.push(entry);
        const xrButtons = this.world.globals.xrButtons as XrButton[] | undefined;
        if (xrButtons) xrButtons.push(entry);
    }

    private saveGuitarCalibration(): void {
        const bar = this.guitarBar();
        if (!bar) return;
        const data = {
            pos:   [bar.position.x, bar.position.y, bar.position.z],
            quat:  [bar.quaternion.x, bar.quaternion.y, bar.quaternion.z, bar.quaternion.w],
            scale: this.guitarScaleNode()?.scale.x ?? GUITAR_SCALE_DEFAULT,
        };
        try {
            localStorage.setItem(GUITAR_CAL_STORAGE_KEY, JSON.stringify(data));
        } catch {
            console.warn('[Calib] Could not save guitar calibration to localStorage.');
        }
    }

    private loadGuitarCalibration(): boolean {
        const bar = this.guitarBar();
        if (!bar) return false;
        try {
            const raw = localStorage.getItem(GUITAR_CAL_STORAGE_KEY);
            if (!raw) return false;
            const d = JSON.parse(raw) as { pos: number[]; quat: number[]; scale: number };
            bar.position.set(d.pos[0], d.pos[1], d.pos[2]);
            bar.quaternion.set(d.quat[0], d.quat[1], d.quat[2], d.quat[3]);
            this.guitarScaleNode()?.scale.setScalar(d.scale);
            return true;
        } catch {
            return false;
        }
    }

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

    private showFineTunePanel(): void {
        const uiPanel = this.world.globals.uiPanel as HTMLDivElement | undefined;
        if (!uiPanel) return;

        this.clearFtButtons();

        (this.world.globals.resizePanel as ((w: number, h: number) => void) | undefined)?.(400, 300);

        if (this._fullRepositionInProgress) {
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
                    <button id="ft-restart" class="button primary-dark icon-btn" type="button"><svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M22.1969 4.98846C21.7569 4.66331 21.1341 4.97748 21.1341 5.52465V7.20266C21.1341 7.27629 21.0744 7.33599 21.0008 7.33599H11.1341C8.18859 7.33599 5.80078 9.72381 5.80078 12.6693V14.6693C5.80078 15.0375 6.09925 15.336 6.46744 15.336H8.20078C8.56897 15.336 8.86744 15.0375 8.86744 14.6693V13.0691C8.86744 11.5963 10.0613 10.4024 11.5341 10.4024H21.0008C21.0744 10.4024 21.1341 10.4621 21.1341 10.5357V12.215C21.1341 12.7621 21.7569 13.0763 22.197 12.7511L26.7242 9.40583C27.0849 9.13934 27.0849 8.59995 26.7242 8.33347L22.1969 4.98846Z" fill="currentColor"/><path d="M16 18.0001C17.1046 18.0001 18 17.1046 18 16.0001C18 14.8955 17.1046 14.0001 16 14.0001C14.8954 14.0001 14 14.8955 14 16.0001C14 17.1046 14.8954 18.0001 16 18.0001Z" fill="currentColor"/><path d="M20.8652 24.6641H10.9986C10.9249 24.6641 10.8652 24.7238 10.8652 24.7975V26.4755C10.8652 27.0226 10.2425 27.3368 9.80241 27.0116L5.27514 23.6666C4.91448 23.4002 4.91447 22.8608 5.27512 22.5943L9.80239 19.249C10.2425 18.9238 10.8652 19.238 10.8652 19.7851V21.4644C10.8652 21.538 10.9249 21.5977 10.9986 21.5977H20.4652C21.938 21.5977 23.1319 20.4038 23.1319 18.931V17.3308C23.1319 16.9626 23.4304 16.6641 23.7986 16.6641H25.5319C25.9001 16.6641 26.1986 16.9626 26.1986 17.3308V19.3308C26.1986 22.2763 23.8108 24.6641 20.8652 24.6641Z" fill="currentColor"/></svg><span>Full Reposition</span></button>
                    <button id="ft-done" class="button primary-light icon-btn" type="button"><svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.6667 6.6548C10.6667 6.10764 11.2894 5.79346 11.7295 6.11862L24.377 15.4634C24.7377 15.7298 24.7377 16.2692 24.3771 16.5357L11.7295 25.8813C11.2895 26.2065 10.6667 25.8923 10.6667 25.3451L10.6667 6.6548Z" fill="currentColor"/></svg><span>Play</span></button>
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

    private updatePanel(): void {
        const uiPanel = this.world.globals.uiPanel as HTMLDivElement | undefined;
        if (!uiPanel) return;

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
