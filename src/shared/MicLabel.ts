// Drops Chrome's trailing hardware id, e.g. "Mic (046d:0825)" -> "Mic", so collapsed names stay short.
export function shortMicLabel(label: string): string {
    return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
}

// Quest lists its own audio routes as inputs. Anything else is an external mic.
const BUILT_IN_LABELS = ['default', 'speakerphone', 'headset earpiece'];
export function isBuiltInMic(label: string): boolean {
    return BUILT_IN_LABELS.includes(label.trim().toLowerCase());
}
