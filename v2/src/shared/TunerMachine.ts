import { STANDARD_BASE_NOTES } from "./SongIndex";

// DOM-free tuner logic shared by the desktop and XR tuner screens.

export type TunerPhase =
    | { tag: 'correction'; stringIndex: number }
    | { tag: 'validation'; stringIndex: number; results: boolean[] }
    | { tag: 'complete' };

export type CheckState = 'done' | 'pending' | null;

export interface TunerReading { frequency: number; clarity: number }

// Time constant for easing the needle toward the detected pitch; higher is calmer but laggier.
const NEEDLE_SMOOTHING_MS = 160;
// Readings in the median filter that rejects single-frame spikes before easing.
const NEEDLE_MEDIAN_WINDOW = 7;
// Minimum pitch-detector clarity (0 to 1) for a reading to move the needle.
const NEEDLE_MIN_CLARITY = 0.8;

// Tolerance thresholds (cents)
const CORRECTION_PASS_CENTS = 10;
const VALIDATION_PASS_CENTS = 15;

// How long the string must stay in tune before advancing (ms)
const CORRECTION_DWELL_MS = 475;
const VALIDATION_DWELL_MS = 235;

// How long a reading may stay out of tolerance (or missing) before the hold resets (ms)
const DWELL_GRACE_MS = 150;

// How long a validation string may stay out of tolerance before falling back to correction (ms)
const VALIDATION_TIMEOUT_MS = 5000;

// How long the complete state shows before auto-advancing (ms)
const COMPLETE_HOLD_MS = 1000;

// Signal level that counts as audible, and how long it may go undetected before the gain doubles.
const AUTO_BOOST_RMS = 0.02;
const AUTO_BOOST_AFTER_MS = 2000;
const MAX_GAIN = 24;

export class TunerMachine {
    readonly offsets: number[];
    readonly targetMidis: number[];

    phase: TunerPhase = { tag: 'correction', stringIndex: 0 };
    detectedCents: number | null = null;
    // Eased copy of detectedCents for drawing only. The phase logic uses the raw value.
    displayCents: number | null = null;
    // Hold progress 0..1, nonzero only while the needle is shown.
    dwellProgress = 0;

    private inputGain: number;
    private readonly onGain: (gain: number) => void;
    private detectedClarity = 0;
    private lastTs = 0;
    private centsHistory: number[] = [];
    private historyString = -1;
    private completeTimestamp = 0;
    private dwellStart = -Infinity;
    private dwellMissSince = -Infinity;
    private validationStringEnteredAt = -Infinity;
    private signalPresentNoDetectStart = -Infinity;
    private autoBoostActive = false;

    // onGain is called when auto-boost raises the gain or resets it to the user's setting.
    constructor(offsets: number[], inputGain: number, onGain: (gain: number) => void) {
        this.offsets = offsets;
        this.targetMidis = computeTargetMidis(offsets);
        this.inputGain = inputGain;
        this.onGain = onGain;
    }

    get currentString(): number {
        return this.phase.tag === 'complete' ? -1 : this.phase.stringIndex;
    }

    get showNeedle(): boolean {
        return this.detectedCents !== null && this.displayCents !== null && this.currentString >= 0;
    }

    setInputGain(gain: number): void {
        this.inputGain = gain;
    }

    // Correction pass: tuned strings are done. Validation pass: every string starts pending
    // from correction and turns done as it is re-verified.
    checkState(i: number): CheckState {
        const p = this.phase;
        return p.tag === 'complete' ? 'done'
            : p.tag === 'validation' ? (p.results[i] ? 'done' : 'pending')
            : (i < p.stringIndex ? 'done' : null);
    }

    // Advances everything for one frame. result is the detector's reading (or null), rms its input level.
    update(timestamp: number, result: TunerReading | null, rms: number): void {
        this.updateAutoBoost(timestamp, result, rms);

        if (this.phase.tag !== 'complete' && this.offsets.length > 0) {
            if (result) {
                const cents = centDeviationWithOctaveCorrection(result.frequency, this.targetMidis[this.currentString]);
                this.detectedCents = cents;
                this.detectedClarity = result.clarity;
                this.advance(cents, timestamp);
            } else {
                this.detectedCents = null;
                this.breakDwell(timestamp);
            }
        }

        this.updateDisplayState(timestamp);
    }

    // True once when the complete state has been shown long enough to move on.
    takeCompleteHold(timestamp: number): boolean {
        if (this.phase.tag !== 'complete' || this.completeTimestamp <= 0) return false;
        if (timestamp - this.completeTimestamp < COMPLETE_HOLD_MS) return false;
        this.completeTimestamp = 0;
        return true;
    }

    restart(): void {
        this.phase = { tag: 'correction', stringIndex: 0 };
        this.detectedCents = null;
        this.dwellStart = -Infinity;
        this.dwellMissSince = -Infinity;
        this.validationStringEnteredAt = -Infinity;
        this.signalPresentNoDetectStart = -Infinity;
        this.autoBoostActive = false;
        this.onGain(this.inputGain);
        this.completeTimestamp = 0;
    }

    private updateAutoBoost(timestamp: number, result: TunerReading | null, rms: number): void {
        if (this.phase.tag !== 'correction' || this.autoBoostActive) return;
        if (result === null && rms > AUTO_BOOST_RMS) {
            if (this.signalPresentNoDetectStart === -Infinity) this.signalPresentNoDetectStart = timestamp;
            if (timestamp - this.signalPresentNoDetectStart >= AUTO_BOOST_AFTER_MS) {
                this.onGain(Math.min(MAX_GAIN, this.inputGain * 2));
                this.autoBoostActive = true;
            }
        } else if (result !== null) {
            this.signalPresentNoDetectStart = -Infinity;
        }
    }

    // Resets the hold only after readings stay bad past the grace period, so single-frame jitter
    // doesn't snap the lock outline back to empty.
    private breakDwell(timestamp: number): void {
        if (this.dwellStart === -Infinity) return;
        if (this.dwellMissSince === -Infinity) this.dwellMissSince = timestamp;
        if (timestamp - this.dwellMissSince >= DWELL_GRACE_MS) {
            this.dwellStart = -Infinity;
            this.dwellMissSince = -Infinity;
        }
    }

    private advance(cents: number, timestamp: number): void {
        const n = this.offsets.length;

        if (this.phase.tag === 'correction') {
            if (Math.abs(cents) <= CORRECTION_PASS_CENTS) {
                this.dwellMissSince = -Infinity;
                if (this.dwellStart === -Infinity) this.dwellStart = timestamp;

                if (timestamp - this.dwellStart >= CORRECTION_DWELL_MS) {
                    this.dwellStart = -Infinity;
                    this.signalPresentNoDetectStart = -Infinity;
                    this.autoBoostActive = false;
                    this.onGain(this.inputGain);

                    const next = this.phase.stringIndex + 1;
                    if (next >= n) {
                        this.validationStringEnteredAt = timestamp;
                        this.phase = { tag: 'validation', stringIndex: 0, results: new Array(n).fill(false) };
                    } else {
                        this.phase = { tag: 'correction', stringIndex: next };
                    }
                }
            } else {
                this.breakDwell(timestamp);
            }
        } else if (this.phase.tag === 'validation') {
            if (Math.abs(cents) <= VALIDATION_PASS_CENTS) {
                this.dwellMissSince = -Infinity;
                if (this.dwellStart === -Infinity) this.dwellStart = timestamp;

                if (timestamp - this.dwellStart >= VALIDATION_DWELL_MS) {
                    this.dwellStart = -Infinity;
                    const results = [...this.phase.results];
                    results[this.phase.stringIndex] = true;
                    const next = this.phase.stringIndex + 1;
                    if (next >= n) {
                        this.phase = { tag: 'complete' };
                        this.completeTimestamp = timestamp;
                    } else {
                        this.validationStringEnteredAt = timestamp;
                        this.phase = { tag: 'validation', stringIndex: next, results };
                    }
                }
            } else {
                this.breakDwell(timestamp);
                if (timestamp - this.validationStringEnteredAt >= VALIDATION_TIMEOUT_MS) {
                    this.validationStringEnteredAt = -Infinity;
                    this.phase = { tag: 'correction', stringIndex: this.phase.stringIndex };
                }
            }
        }
    }

    // Updates the eased needle value and hold progress that every renderer reads.
    private updateDisplayState(timestamp: number): void {
        const currentString = this.currentString;

        const dt = timestamp - this.lastTs;
        this.lastTs = timestamp;
        if (this.detectedCents === null || currentString !== this.historyString) this.centsHistory = [];
        this.historyString = currentString;
        if (this.detectedCents === null) {
            this.displayCents = null;
        } else {
            // Low-clarity readings (harmonics, octave slips) are skipped for display only, so the
            // needle holds its last spot instead of leaping.
            if (this.detectedClarity >= NEEDLE_MIN_CLARITY) {
                this.centsHistory.push(this.detectedCents);
                if (this.centsHistory.length > NEEDLE_MEDIAN_WINDOW) this.centsHistory.shift();
            }
            if (this.centsHistory.length > 0) {
                const target = [...this.centsHistory].sort((a, b) => a - b)[this.centsHistory.length >> 1];
                this.displayCents = this.displayCents === null || this.centsHistory.length === 1
                    ? target
                    : this.displayCents + (target - this.displayCents) * (1 - Math.exp(-dt / NEEDLE_SMOOTHING_MS));
            }
        }

        const dwellMs = this.phase.tag === 'correction' ? CORRECTION_DWELL_MS : VALIDATION_DWELL_MS;
        this.dwellProgress = this.showNeedle && this.dwellStart !== -Infinity
            ? Math.min(1, (timestamp - this.dwellStart) / dwellMs)
            : 0;
    }
}

function computeTargetMidis(offsets: number[]): number[] {
    const base = STANDARD_BASE_NOTES[offsets.length];
    if (!base) return offsets.map(() => 69);
    return base.map((b, i) => b + (offsets[i] ?? 0));
}

function centDeviation(detectedFreq: number, targetMidi: number): number {
    const targetFreq = 440 * Math.pow(2, (targetMidi - 69) / 12);
    return 1200 * Math.log2(detectedFreq / targetFreq);
}

function centDeviationWithOctaveCorrection(detectedFreq: number, targetMidi: number): number {
    const raw = centDeviation(detectedFreq, targetMidi);
    return [raw, raw - 1200, raw + 1200].reduce((best, c) => Math.abs(c) < Math.abs(best) ? c : best);
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
    const octave = Math.floor(midi / 12) - 1;
    return NOTE_NAMES_SHARP[midi % 12] + octave;
}

// Past ±99 the exact number adds nothing (needle is pinned), so say which way to go.
export function centsLabel(cents: number): string {
    const shown = Math.round(cents);
    return Math.abs(shown) > 99 ? (shown > 0 ? 'Sharp' : 'Flat') : (shown > 0 ? `+${shown}` : `${shown}`);
}
