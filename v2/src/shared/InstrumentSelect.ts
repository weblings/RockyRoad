// Shared instrument-selection logic — used by both src/xr/XRPreScene.ts and
// src/desktop/PreSceneScreen.ts so the two platforms behave identically (see
// ThreeCP/Analysis/DifficultyDropdownPlan.md's "Phase 3 detail").

import type { SongIndexEntry, SongIndexPart } from "./SongIndex";

export const PART_LABEL: Record<string, string> = {
    LeadGuitar: 'Lead', RhythmGuitar: 'Rhythm', BassGuitar: 'Bass',
    Keys: 'Keys', Drums: 'Drums',
};

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
