import * as THREE from "three";
import { createSystem, InputComponent, PanelDocument } from "@iwsdk/core";
import type { Entity, UIKitDocument } from "@iwsdk/core";
import { loadSettings } from "../shared/Settings";

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

// Guitar/Bass has no physical instrument to size-match — scale is a settings-driven
// multiplier instead, reusing the piano's per-unit scale as the 1x reference so a full
// 24-fret neck lands at a real-guitar-plausible ~0.65m.
const GUITAR_SCALE_BASE = PIANO_SCALE_88;

// Real-world gap between the guitar grab bar and highway content at 1x scale —
// eyeballed as an eighth of the panel's center-offset (0.169), since the panel's
// actual visible gap to the bar is much smaller than that center measurement.
const GUITAR_BASE_OFFSET = 0.169 / 8;

// FretPlayerScene3D.getStringHeight(0) — game units from the content node's
// origin up to the lowest string line, the highway's visible bottom edge.
const GUITAR_LOWEST_STRING_UNITS = 3;

const GUITAR_CAL_STORAGE_KEY = 'xr-guitar-calibration';

// How far in front of the head (along raw, unflattened camera-forward) the
// guitar volume is auto-placed on first calibration.
const GUITAR_PLACEMENT_DISTANCE = 1.0;

// ── CalibrationSystem ─────────────────────────────────────────────────────────
// uikit-based (see ui/calibration.uikitml) — last screen-by-screen migration
// step off html2canvas. Same idiom as XRSettingsScene.ts/XRSongLibrary.ts:
// poll for the PanelDocument once (see _withDoc()), then wire onClick/
// setProperties per element instead of building an innerHTML string.

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

    private _doc: UIKitDocument | null = null;

    init(): void {
        this.world.globals.startCalibration = (onComplete: () => void): void => {
            if (this.isGuitarActive()) {
                this.startGuitarCalibration(onComplete);
                return;
            }
            this._onComplete = onComplete;
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

        // Guitar/Bass has no instrument to touch-calibrate against, so Reposition (both
        // recalibrate and showCalibrationFineTune below) just redoes placeGuitarBar()'s
        // camera-forward drop instantly and returns — no confirm screen, Play HUD never hides.
        this.world.globals.recalibrate = (onComplete: () => void): void => {
            this.cancelCountdown();
            if (this.isGuitarActive()) {
                this.placeGuitarBar();
                this.setGuitarBarVisible(true);
                this.saveGuitarCalibration();
                onComplete();
                return;
            }
            // Only reached from Play HUD's Reposition button, whose onComplete is just a
            // rerender() (not a full showActiveScene()) — nothing else restores playPanelObj's
            // visibility or interactivity after _showPanel() hides both, so do it here.
            this._onComplete = () => {
                const obj = this.world.globals.playPanelObj as THREE.Object3D | undefined;
                if (obj) obj.visible = true;
                (this.world.globals.setPlayPanelInteractive as ((e: boolean) => void) | undefined)?.(true);
                onComplete();
            };
            this.state = 'done';
            this.showFineTunePanel();
            this.reapply();
        };

        this.world.globals.showCalibrationFineTune = (onComplete: () => void): void => {
            this.cancelCountdown();
            if (this.isGuitarActive()) {
                this.placeGuitarBar();
                this.setGuitarBarVisible(true);
                this.saveGuitarCalibration();
                onComplete();
                return;
            }
            this._onComplete = onComplete;
            this.state = 'done';
            this.showFineTunePanel();
            this.reapply();
        };

        this.world.globals.setGuitarHighwayScale = (multiplier: number): void => {
            this.applyGuitarHighwayScale(multiplier);
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

    private guitarContentOffsetNode(): THREE.Object3D | undefined {
        return this.world.globals.guitarContentOffsetNode as THREE.Object3D | undefined;
    }

    // Applies a highway-size multiplier to content scale + grab-bar offset. The offset
    // node sits outside the scaled subtree (bar doesn't scale) but the highway's visible
    // bottom edge is inside it, so compensate the fixed offset to keep the total gap
    // constant at GUITAR_BASE_OFFSET regardless of multiplier.
    private applyGuitarHighwayScale(multiplier: number): void {
        const scaleNode  = this.guitarScaleNode();
        const offsetNode = this.guitarContentOffsetNode();
        if (scaleNode) scaleNode.scale.setScalar(GUITAR_SCALE_BASE * multiplier);
        if (offsetNode) {
            offsetNode.position.y = GUITAR_BASE_OFFSET
                - GUITAR_LOWEST_STRING_UNITS * GUITAR_SCALE_BASE * (multiplier - 1);
        }
    }

    private setGuitarBarVisible(visible: boolean): void {
        const bar = this.guitarBar();
        if (bar) bar.visible = visible;
    }

    // Instant, same as recalibrate()/showCalibrationFineTune()'s guitar
    // branch — no confirm screen, just place the bar and let the highway
    // show up. No panel involved, so nothing to hide/restore.
    private startGuitarCalibration(onComplete: () => void): void {
        this.placeGuitarBar();
        this.setGuitarBarVisible(true);
        this.saveGuitarCalibration();
        onComplete();
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
        this.applyGuitarHighwayScale(loadSettings().guitarHighwayScale);
    }

    private saveGuitarCalibration(): void {
        const bar = this.guitarBar();
        if (!bar) return;
        const data = {
            pos:  [bar.position.x, bar.position.y, bar.position.z],
            quat: [bar.quaternion.x, bar.quaternion.y, bar.quaternion.z, bar.quaternion.w],
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
            const d = JSON.parse(raw) as { pos: number[]; quat: number[] };
            bar.position.set(d.pos[0], d.pos[1], d.pos[2]);
            bar.quaternion.set(d.quat[0], d.quat[1], d.quat[2], d.quat[3]);
            // Scale is settings-driven (Settings.guitarHighwayScale), not part of
            // saved position/rotation calibration data.
            this.applyGuitarHighwayScale(loadSettings().guitarHighwayScale);
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
        this._showPanel();

        if (this._fullRepositionInProgress) {
            this._withDoc(doc => {
                doc.getElementById('cal-finetune')?.setProperties({ display: 'none' });
                doc.getElementById('cal-prompt')?.setProperties({ display: 'flex' });
                doc.getElementById('cal-prompt-heading')?.setProperties({ text: this.promptHeading() });
                doc.getElementById('cal-prompt-text')?.setProperties({ text: this.promptBody() });
            });
            return;
        }

        this._withDoc(doc => {
            doc.getElementById('cal-prompt')?.setProperties({ display: 'none' });
            doc.getElementById('cal-finetune')?.setProperties({ display: 'flex' });

            const incr = () => INCR_STEPS[this._ftIncrIdx];
            const reg = (id: string, onClick: () => void): void => {
                doc.getElementById(id)?.setProperties({ onClick });
            };

            reg('cal-pxm', () => { this._ftPX -= incr(); this.reapply(); });
            reg('cal-pxp', () => { this._ftPX += incr(); this.reapply(); });
            reg('cal-pym', () => { this._ftPY -= incr(); this.reapply(); });
            reg('cal-pyp', () => { this._ftPY += incr(); this.reapply(); });
            reg('cal-pzm', () => { this._ftPZ -= incr(); this.reapply(); });
            reg('cal-pzp', () => { this._ftPZ += incr(); this.reapply(); });
            reg('cal-rym', () => { this._ftRY -= incr(); this.reapply(); });
            reg('cal-ryp', () => { this._ftRY += incr(); this.reapply(); });
            reg('cal-sm',  () => { this._ftS  -= incr(); this.reapply(); });
            reg('cal-sp',  () => { this._ftS  += incr(); this.reapply(); });
            reg('cal-incrm', () => {
                this._ftIncrIdx = Math.max(0, this._ftIncrIdx - 1);
                this.refreshValues();
            });
            reg('cal-incrp', () => {
                this._ftIncrIdx = Math.min(INCR_STEPS.length - 1, this._ftIncrIdx + 1);
                this.refreshValues();
            });
            reg('cal-restart', () => {
                this._fullRepositionInProgress = true;
                this.state = 'prompt_left';
                this.setHighwayVisible(false);
                this.showFineTunePanel();
            });
            reg('cal-done', () => {
                this.saveCalibration();
                this._onComplete?.();
                this._onComplete = null;
            });

            this.refreshValues();
        });
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
        this._withDoc(doc => {
            doc.getElementById('cal-px-val')?.setProperties({ text: this._ftPX.toFixed(3) });
            doc.getElementById('cal-py-val')?.setProperties({ text: this._ftPY.toFixed(3) });
            doc.getElementById('cal-pz-val')?.setProperties({ text: this._ftPZ.toFixed(3) });
            doc.getElementById('cal-ry-val')?.setProperties({ text: this._ftRY.toFixed(1) });
            doc.getElementById('cal-s-val')?.setProperties({ text: this._ftS.toFixed(3) });
            doc.getElementById('cal-incr-val')?.setProperties({ text: String(INCR_STEPS[this._ftIncrIdx]) });
        });
    }

    private promptHeading(): string {
        return this.state === 'prompt_right' ? 'Step 2 of 2' : 'Step 1 of 2';
    }

    private promptBody(): string {
        const ctrl = !this.hasHandInputSources();
        const messages: Record<CalibrationState, string> = {
            idle:  '',
            done:  '',
            prompt_left: ctrl
                ? 'Rest your LEFT controller\non the leftmost key\nand pull the left trigger.'
                : 'Touch the leftmost key\nwith your left index finger\nand pinch to confirm.',
            prompt_right: ctrl
                ? 'Rest your RIGHT controller\non the rightmost key\nand pull the right trigger.'
                : 'Touch the rightmost key\nwith your right index finger\nand pinch to confirm.',
        };
        return messages[this.state];
    }

    private updatePanel(): void {
        this._showPanel();
        this._withDoc(doc => {
            doc.getElementById('cal-finetune')?.setProperties({ display: 'none' });
            doc.getElementById('cal-prompt')?.setProperties({ display: 'flex' });
            doc.getElementById('cal-prompt-heading')?.setProperties({ text: this.promptHeading() });
            doc.getElementById('cal-prompt-text')?.setProperties({ text: this.promptBody() });
        });
    }

    // ── uikit panel plumbing ─────────────────────────────────────────────────

    // recalibrate()/showCalibrationFineTune() are reachable mid-countdown (Play HUD's
    // Reposition doesn't wait for one to finish) — without cancelling, the pending
    // setTimeout would yank the user back to Play HUD mid-calibration. Exposed via
    // world.globals since index.ts's countdown closure isn't otherwise reachable here.
    private cancelCountdown(): void {
        (this.world.globals.cancelCountdown as (() => void) | undefined)?.();
    }

    // All uikit panels share the same grabBarEntity slot; only one is ever visible, and
    // every show-path elsewhere hides its siblings first (see UikitLessonsLearned.md).
    // This is calibration's equivalent, kept here since only CalibrationSystem knows a
    // panel is about to show — only Keys' paths call this; Guitar is always instant/no-panel.
    //
    // Disables each sibling's interactivity too, not just its visibility — some callers
    // (Play HUD's Reposition button) only hide their own panel visually before reaching
    // here, leaving it fully ray-interactive and coincident with this panel underneath it.
    private _showPanel(): void {
        const g = this.world.globals;
        const hide = (obj: unknown, setInteractive: unknown): void => {
            if (obj instanceof THREE.Object3D) obj.visible = false;
            (setInteractive as ((e: boolean) => void) | undefined)?.(false);
        };
        hide(g.libraryPanelObj,  g.setLibraryPanelInteractive);
        hide(g.settingsPanelObj, g.setSettingsPanelInteractive);
        hide(g.preScenePanelObj, g.setPreScenePanelInteractive);
        hide(g.playPanelObj,     g.setPlayPanelInteractive);

        const obj = g.calibrationPanelObj as THREE.Object3D | undefined;
        if (obj) obj.visible = true;
        (g.setCalibrationPanelInteractive as ((e: boolean) => void) | undefined)?.(true);
    }

    // Polls until the PanelDocument is ready, caching it — same pattern as
    // XRSettingsScene.ts/XRSongLibrary.ts. Only caches + runs the callback — does NOT
    // touch pointerEvents (that's _showPanel()'s job via setCalibrationPanelInteractive()).
    // This is called by read-only paths too (refreshValues() via reapply(), reached just
    // from browsing to a Keys song, not from actually showing this panel) — a stray
    // pointerEvents:'auto' here used to silently re-enable the panel while it was still
    // invisible and coincident with whatever screen was actually showing.
    private _withDoc(cb: (doc: UIKitDocument) => void): void {
        if (this._doc) { cb(this._doc); return; }
        const entity = this.world.globals.calibrationPanelEntity as Entity | undefined;
        if (!entity) return;
        const doc = entity.getValue(PanelDocument, 'document') as UIKitDocument | null;
        if (doc) {
            this._doc = doc;
            cb(doc);
            return;
        }
        setTimeout(() => this._withDoc(cb), 100);
    }
}
