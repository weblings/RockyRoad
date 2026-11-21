// MicSource — single owner of mic permission, stream, device and gain.
// Consumers borrow the shared detector. App releases it at the library.
import type { PitchDetector } from "./PitchDetector";
import { loadSettings } from "./Settings";

class MicSource {
    private stream: MediaStream | null = null;
    private detector: PitchDetector | null = null;
    private pending: Promise<PitchDetector | null> | null = null;
    // Bumped by release() so a request still resolving after it is discarded.
    private generation = 0;
    private deviceId: string | undefined;
    private gain: number | null = null;

    get current(): PitchDetector | null { return this.detector; }
    get selectedDeviceId(): string | undefined { return this.deviceId; }

    // Reuses the open detector. Concurrent callers share one prompt. Null if denied or released.
    acquire(): Promise<PitchDetector | null> {
        if (this.detector) return Promise.resolve(this.detector);
        this.pending ??= this.open();
        return this.pending;
    }

    setGain(value: number): void {
        this.gain = value;
        this.detector?.setGain(value);
    }

    // Reopens on the chosen device. The detector instance changes, so callers re-read current.
    async setDevice(deviceId: string | undefined): Promise<PitchDetector | null> {
        this.deviceId = deviceId;
        this.teardown();
        return this.acquire();
    }

    release(): void {
        this.teardown();
    }

    private teardown(): void {
        this.generation++;
        this.detector?.destroy();
        this.detector = null;
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
        this.pending = null;
    }

    private async open(): Promise<PitchDetector | null> {
        const gen = this.generation;
        let stream: MediaStream | null = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId:         this.deviceId ? { exact: this.deviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl:  false,
                },
            });
            const { PitchDetector } = await import("./PitchDetector");
            const gain = this.gain ?? loadSettings().inputGain ?? 1;
            const det = await PitchDetector.create(undefined, gain, undefined, undefined, stream);
            if (gen !== this.generation) { det.destroy(); stream.getTracks().forEach(t => t.stop()); return null; }
            this.stream = stream;
            this.detector = det;
            return det;
        } catch {
            stream?.getTracks().forEach(t => t.stop());
            return null;
        } finally {
            if (gen === this.generation) this.pending = null;
        }
    }
}

export const micSource = new MicSource();
