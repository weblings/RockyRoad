// Shared instrument-selection logic — used by both src/xr/XRPreScene.ts and
// src/desktop/PreSceneScreen.ts so the two platforms behave identically.

import type { SongIndexEntry, SongIndexPart } from "./SongIndex";

export const PART_LABEL: Record<string, string> = {
    LeadGuitar: 'Lead', RhythmGuitar: 'Rhythm', BassGuitar: 'Bass',
    Keys: 'Keys', Drums: 'Drums',
};

// "What instruments does this song support" grouping for library-card badges — coarser than
// PART_LABEL (Lead/Rhythm share one "Guitar" badge; Drums omitted, unsupported everywhere).
// Shared so desktop and XR libraries render the same badge set from one source of truth.
export const BADGE_LABELS: { types: string[]; label: string }[] = [
    { types: ['BassGuitar'],                 label: 'Bass' },
    { types: ['Keys'],                       label: 'Keys' },
    { types: ['LeadGuitar', 'RhythmGuitar'], label: 'Guitar' },
];

// Default-instrument chain: last-used type (if this song has it) -> Keys -> Lead ->
// first playable (non-Vocals) part -> Vocals, if that's genuinely all there is.
export function resolveDefaultPart(
    entry: SongIndexEntry,
    lastInstrumentType: string | null,
): SongIndexPart | undefined {
    const playable = entry.parts.filter(p => p.type !== 'Vocals');
    if (playable.length === 0) return entry.parts[0];

    if (lastInstrumentType) {
        const match = playable.find(p => p.type === lastInstrumentType);
        if (match) return match;
    }

    return playable.find(p => p.type === 'Keys')
        ?? playable.find(p => p.type === 'LeadGuitar')
        ?? playable[0];
}
