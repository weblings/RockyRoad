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

export class PitchDetector {
    private ctx: AudioContext;
    private analyser: AnalyserNode;
    private gainNode: GainNode;
    private buf: Float32Array<ArrayBuffer>;
    private stream: MediaStream;

    // Last measured RMS signal level (0–1). Updated on every detect() call even
    // when no pitch is found — lets the UI show a signal meter without a null check.
    lastRms = 0;

    private constructor(ctx: AudioContext, analyser: AnalyserNode, gainNode: GainNode, stream: MediaStream) {
        this.ctx      = ctx;
        this.analyser = analyser;
        this.gainNode = gainNode;
        this.buf      = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
        this.stream   = stream;
    }

    static async create(deviceId?: string, gain = 1): Promise<PitchDetector> {
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
        source.connect(gainNode);
        gainNode.connect(analyser);
        // Intentionally NOT connecting analyser → ctx.destination (no monitoring)
        return new PitchDetector(ctx, analyser, gainNode, stream);
    }

    setGain(value: number): void {
        this.gainNode.gain.value = value;
    }

    detect(): PitchResult | null {
        this.analyser.getFloatTimeDomainData(this.buf);
        const result = autocorrelate(this.buf, this.ctx.sampleRate);
        this.lastRms = result?.rms ?? computeRms(this.buf);
        return result;
    }

    destroy(): void {
        this.stream.getTracks().forEach(t => t.stop());
        this.ctx.close();
    }
}

// ── NSDF pitch detection (McLeod Pitch Method) ────────────────────────────────
//
// Uses the Normalised Square Difference Function rather than raw autocorrelation.
// nsdf[lag] = 2·r[lag] / m[lag]
//   r[lag]  = Σ x[i]·x[i+lag]           (standard autocorrelation)
//   m[lag]  = Σ (x[i]² + x[i+lag]²)    (running energy denominator)
//
// m is updated incrementally: m[lag] = m[lag−1] − x[lag−1]² − x[N−lag]²
//
// nsdf ∈ [−1, 1] — the normalisation removes the amplitude dependence that
// makes r[minLag] a poor reference for harmonic-heavy sustained signals (e.g.
// a held A2 whose overtones dominate the raw autocorrelation peak).

function computeRms(buf: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
}

function autocorrelate(buf: Float32Array, sampleRate: number): PitchResult | null {
    const N = buf.length;

    // Silence check — skip processing if RMS is below noise floor
    const rms = computeRms(buf);
    if (rms < 0.005) return null;

    // Lag range:
    //   max frequency to detect: ~1400 Hz (covers guitar high e fretted)
    //   min frequency to detect: ~30 Hz (covers bass 5-string low B)
    const minLag = Math.floor(sampleRate / 1400);
    const maxLag = Math.ceil(sampleRate / 30);
    if (maxLag >= N) return null;

    // Build NSDF over [0, maxLag].
    // m[0] = 2 · Σ x[i]²; then decremented each lag step.
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

    // Find the highest NSDF peak after the first negative-to-positive zero crossing
    // that occurs after minLag (skips the trivial lag=0 maximum).
    let start = minLag;
    while (start < maxLag && nsdf[start] > 0) start++;
    if (start >= maxLag) return null;

    let bestLag = start;
    for (let lag = start + 1; lag <= maxLag; lag++) {
        if (nsdf[lag] > nsdf[bestLag]) bestLag = lag;
    }

    const clarity = nsdf[bestLag]; // ∈ [−1, 1]; 1 = perfect periodic signal
    if (clarity < 0.40) return null;

    // Parabolic interpolation for sub-sample accuracy
    const y0 = bestLag > 0      ? nsdf[bestLag - 1] : nsdf[bestLag];
    const y1 = nsdf[bestLag];
    const y2 = bestLag < maxLag ? nsdf[bestLag + 1] : nsdf[bestLag];
    const denom = 2 * (2 * y1 - y0 - y2);
    const refinedLag = denom !== 0 ? bestLag + (y0 - y2) / denom : bestLag;

    const frequency = sampleRate / refinedLag;

    return { frequency, clarity: Math.min(1, Math.max(0, clarity)), rms };
}
