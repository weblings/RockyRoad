// Drops Chrome's trailing hardware id, e.g. "Mic (046d:0825)" -> "Mic", so collapsed names stay short.
export function shortMicLabel(label: string): string {
    return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
}
