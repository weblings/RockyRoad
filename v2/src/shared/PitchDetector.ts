// PitchDetector — Web Audio autocorrelation pitch detection.
// Usage:
//   const det = await PitchDetector.create(optionalDeviceId);
//   const result = det.detect();  // call each rAF tick
//   det.destroy();                // stop mic and close AudioContext

export interface PitchResult {
    frequency: number;  // Hz
    clarity: number;    // 0–1, autocorrelation confidence
    rms: number;        // 0–1, signal level at time of detection
}

const DEFAULT_MIN_RMS = 0.005;
const DEFAULT_MIN_HZ  = 30;
// High-pass corner as a fraction of minHz.
const HIGHPASS_RATIO  = 0.9;
// McLeod key-maximum rule: take the first NSDF peak within this fraction of the tallest, so a
// whole-number multiple of the period (a sub-octave) can't win just by being slightly taller.
const KEY_RATIO       = 0.9;

export class PitchDetector {
    private ctx: AudioContext;
    private analyser: AnalyserNode;
    private gainNode: GainNode;
    private buf: Float32Array<ArrayBuffer>;
    private stream: MediaStream;
    private source: MediaStreamAudioSourceNode;
    private capture: { node: ScriptProcessorNode; chunks: Int16Array[]; samples: number; max: number } | null = null;

    // Last measured RMS signal level (0–1). Updated on every detect() call even
    // when no pitch is found — lets the UI show a signal meter without a null check.
    lastRms = 0;

    private minRms: number;
    private minHz: number;

    private constructor(
        ctx: AudioContext, analyser: AnalyserNode, gainNode: GainNode, stream: MediaStream, minRms: number,
        source: MediaStreamAudioSourceNode, minHz: number,
    ) {
        this.source   = source;
        this.minHz    = minHz;
        this.minRms   = minRms;
        this.ctx      = ctx;
        this.analyser = analyser;
        this.gainNode = gainNode;
        this.buf      = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
        this.stream   = stream;
    }

    // minRms is the post-gain level below which a frame is treated as silence.
    // minHz is the lowest pitch to look for (e.g. the lowest target string). It also sets a
    // high-pass just below it, so room and table rumble can't be mistaken for a note.
    static async create(
        deviceId?: string, gain = 1, minRms = DEFAULT_MIN_RMS, minHz = DEFAULT_MIN_HZ,
    ): Promise<PitchDetector> {
        const constraints: MediaStreamConstraints = {
            audio: {
                deviceId:           deviceId ? { exact: deviceId } : undefined,
                echoCancellation:   false,
                noiseSuppression:   false,
                autoGainControl:    false,
            },
        };
        const stream   = await navigator.mediaDevices.getUserMedia(constraints);
        const ctx      = new AudioContext();
        const source   = ctx.createMediaStreamSource(stream);
        const gainNode = ctx.createGain();
        gainNode.gain.value = gain;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = minHz * HIGHPASS_RATIO;
        source.connect(highpass);
        highpass.connect(gainNode);
        gainNode.connect(analyser);
        return new PitchDetector(ctx, analyser, gainNode, stream, minRms, source, minHz);
    }

    setGain(value: number): void {
        this.gainNode.gain.value = value;
    }

    detect(): PitchResult | null {
        this.analyser.getFloatTimeDomainData(this.buf);
        const result = autocorrelate(this.buf, this.ctx.sampleRate, this.minRms, this.minHz);
        this.lastRms = result?.rms ?? computeRms(this.buf);
        return result;
    }

    get sampleRate(): number { return this.ctx.sampleRate; }

    // What the browser actually applied (it may ignore the echo/noise/AGC constraints).
    get trackSettings(): MediaTrackSettings { return this.stream.getAudioTracks()[0]?.getSettings() ?? {}; }

    // Dev capture of the raw (pre-gain) mic as Int16, capped at maxSeconds. Dev tooling only.
    startCapture(maxSeconds: number): void {
        if (this.capture) return;
        const node = this.ctx.createScriptProcessor(4096, 1, 1);
        const cap = { node, chunks: [] as Int16Array[], samples: 0, max: Math.floor(maxSeconds * this.ctx.sampleRate) };
        node.onaudioprocess = e => {
            if (cap.samples >= cap.max) return;
            const input = e.inputBuffer.getChannelData(0);
            const out = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) out[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
            cap.chunks.push(out);
            cap.samples += out.length;
        };
        // ScriptProcessor only runs when connected onward, so route it through a muted gain.
        const mute = this.ctx.createGain();
        mute.gain.value = 0;
        this.source.connect(node);
        node.connect(mute);
        mute.connect(this.ctx.destination);
        this.capture = cap;
    }

    stopCapture(): Int16Array | null {
        const cap = this.capture;
        if (!cap) return null;
        this.capture = null;
        cap.node.disconnect();
        this.source.disconnect(cap.node);
        const pcm = new Int16Array(cap.samples);
        let o = 0;
        for (const c of cap.chunks) { pcm.set(c, o); o += c.length; }
        return pcm;
    }

    destroy(): void {
        this.stream.getTracks().forEach(t => t.stop());
        this.ctx.close();
    }
}

function computeRms(buf: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
}

export function autocorrelate(
    buf: Float32Array, sampleRate: number, minRms: number, minHz = DEFAULT_MIN_HZ, keyRatio = KEY_RATIO,
): PitchResult | null {
    const N = buf.length;

    const rms = computeRms(buf);
    if (rms < minRms) return null;

    const minLag = Math.floor(sampleRate / 1400);
    const maxLag = Math.ceil(sampleRate / minHz);
    if (maxLag >= N) return null;

    let m = 0;
    for (let i = 0; i < N; i++) m += buf[i] * buf[i];
    m *= 2;

    const nsdf = new Float32Array(maxLag + 1);
    for (let lag = 0; lag <= maxLag; lag++) {
        if (lag > 0) {
            m -= buf[lag - 1] * buf[lag - 1] + buf[N - lag] * buf[N - lag];
        }
        if (m <= 0) break;

        let r = 0;
        const limit = N - lag;
        for (let i = 0; i < limit; i++) r += buf[i] * buf[i + lag];
        nsdf[lag] = (2 * r) / m;
    }

    let start = minLag;
    while (start < maxLag && nsdf[start] > 0) start++;
    if (start >= maxLag) return null;

    let tallest = start;
    for (let lag = start + 1; lag <= maxLag; lag++) {
        if (nsdf[lag] > nsdf[tallest]) tallest = lag;
    }
    // Peak of each positive run, in lag order. The first one near the tallest is the period.
    let bestLag = tallest;
    let runPeak = -1;
    for (let lag = start; lag <= maxLag; lag++) {
        if (nsdf[lag] > 0) {
            if (runPeak < 0 || nsdf[lag] > nsdf[runPeak]) runPeak = lag;
        } else if (runPeak >= 0) {
            if (nsdf[runPeak] >= keyRatio * nsdf[tallest]) { bestLag = runPeak; break; }
            runPeak = -1;
        }
    }

    const clarity = nsdf[bestLag];
    if (clarity < 0.40) return null;

    const y0 = bestLag > 0      ? nsdf[bestLag - 1] : nsdf[bestLag];
    const y1 = nsdf[bestLag];
    const y2 = bestLag < maxLag ? nsdf[bestLag + 1] : nsdf[bestLag];
    const denom = 2 * (2 * y1 - y0 - y2);
    const refinedLag = denom !== 0 ? bestLag + (y0 - y2) / denom : bestLag;

    const frequency = sampleRate / refinedLag;

    return { frequency, clarity: Math.min(1, Math.max(0, clarity)), rms };
}
