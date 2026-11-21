// All Polyphon adapter tuning in one place. Override per run with URL params, e.g.
// ?input=polyphon&pp.model=fast&pp.on=0.5&pp.off=0.3&pp.minProb=0.6&pp.retrigger=0.15

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
    /** Folder holding the package's engine/ and models/. */
    assetBaseUrl: string;
}

export const DEFAULT_POLYPHON_CONFIG: PolyphonConfig = {
    model: 'piano',
    threshold: null,
    minProb: 0,
    retriggerRise: 0.2,
    gateWindow: 0.25,
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
        assetBaseUrl: params.get('pp.assets') ?? base.assetBaseUrl,
    };
}
