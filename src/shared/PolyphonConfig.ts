// All Polyphon adapter tuning in one place. Override per run with URL params, e.g.
// ?input=polyphon&pp.model=fast&pp.on=0.5&pp.off=0.3&pp.minProb=0.6&pp.retrigger=0.15&pp.gain=2&pp.offset=0.03

import type { LatencyBreakdown } from './NoteTimeMapper';

export type PolyphonModel = 'fast' | 'piano' | 'voice' | 'fft';

export interface PolyphonConfig {
    model: PolyphonModel;
    /** Model on/off probability override. Null keeps the model's own operating point. */
    threshold: { on: number; off: number } | null;
    /** An onset needs at least this probability. */
    minProb: number;
    /** A held note re-fires when its probability rises this far above its lowest since onset. 0 disables. */
    retriggerRise: number;
    /** Onsets are kept only for pitches with a target within this many song seconds. */
    gateWindow: number;
    /** Linear input gain applied to the mic stream before detection. 1 leaves the stream untouched. */
    gain: number;
    /** Folder holding the package's engine/ and models/. */
    assetBaseUrl: string;
}

export const DEFAULT_POLYPHON_CONFIG: PolyphonConfig = {
    model: 'piano',
    threshold: null,
    minProb: 0,
    retriggerRise: 0.2,
    gateWindow: 0.15,
    gain: 1,
    assetBaseUrl: '/node_modules/@markusstrasser/pitchplease/',
};

export function polyphonConfigFromParams(
    params: URLSearchParams,
    base: PolyphonConfig = DEFAULT_POLYPHON_CONFIG,
): PolyphonConfig {
    const num = (k: string): number | undefined => {
        const v = params.get(`pp.${k}`);
        return v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v);
    };
    const model = params.get('pp.model');
    const on = num('on');
    const off = num('off');
    return {
        model: model === 'fast' || model === 'piano' || model === 'voice' || model === 'fft' ? model : base.model,
        threshold: on !== undefined ? { on, off: off ?? on * 0.6 } : base.threshold,
        minProb: num('minProb') ?? base.minProb,
        retriggerRise: num('retrigger') ?? base.retriggerRise,
        gateWindow: num('gate') ?? base.gateWindow,
        gain: num('gain') ?? base.gain,
        assetBaseUrl: params.get('pp.assets') ?? base.assetBaseUrl,
    };
}

/** Fixed latency in real seconds. Detector includes 0.06 s measured from Mary replays (kvg.8). */
export const POLYPHON_LATENCY: LatencyBreakdown = { detector: 0.11, input: 0.02, delivery: 0.02, output: 0.03 };

/** Extra offset in real seconds from `pp.offset`, for tuning latency without a rebuild. */
export function polyphonOffsetFromParams(params: URLSearchParams): number {
    const v = params.get('pp.offset');
    return v === null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v);
}
