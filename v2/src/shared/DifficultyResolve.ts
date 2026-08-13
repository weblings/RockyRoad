// Merges instrumentNotes.Notes (the implicit hardest tier) with instrumentNotes.AlternateLevels
// (explicit easier tiers, phrase-scoped) into a single flat note array matching a selected
// difficulty. Pure, no rendering dependency — shared by XR's index.ts and desktop's
// ActiveSceneScreen.ts (desktop passes null today, since it has no Difficulty selector yet).

import type { SongInstrumentNotes, SongNote, SongDifficultyLevel } from "./SongFormat";

export function resolveNotesForDifficulty(
    instrumentNotes: SongInstrumentNotes,
    selectedDifficulty: number | null,
): SongNote[] {
    const { Notes, AlternateLevels, Sections } = instrumentNotes;

    // No selection (desktop today, or a song with no alternate tiers at all) — unchanged.
    if (selectedDifficulty == null || !AlternateLevels?.length || !Sections?.length) return Notes;

    const result: SongNote[] = [];
    const claimed = new Set<SongNote>();

    // Difficulty 0 is a real, valid tier — just omitted from the JSON by the C# side's
    // WhenWritingDefault serialization, not distinguishable from "field absent". Treat both as 0.
    const diffOf = (level: SongDifficultyLevel): number => level.Difficulty ?? 0;

    for (const phrase of Sections) {
        const start = phrase.StartTime ?? 0;
        const end   = phrase.EndTime   ?? Infinity;

        const altsForPhrase = AlternateLevels.filter(
            a => a.StartTime === phrase.StartTime && a.EndTime === phrase.EndTime,
        );

        // Top tier (the flat Notes slice for this phrase) is definitionally harder than every
        // alt tier recorded for this phrase (that's how the converter decides what becomes an
        // AlternateLevels entry vs. the default Notes) — so "at or above this phrase's hardest
        // recorded alt tier" means top tier is the correct (and only) choice, regardless of its
        // own exact numeric value, which isn't recorded anywhere.
        const maxAlt = altsForPhrase.length > 0
            ? Math.max(...altsForPhrase.map(diffOf))
            : -Infinity;

        if (selectedDifficulty >= maxAlt) {
            for (const n of Notes) {
                if (n.TimeOffset >= start && n.TimeOffset < end) {
                    result.push(n);
                    claimed.add(n);
                }
            }
            continue;
        }

        // Nearest available tier at or below the selection; if every recorded tier for this
        // phrase is harder than requested, fall back to the easiest one available.
        const belowOrEqual = altsForPhrase.filter(a => diffOf(a) <= selectedDifficulty);
        const chosen = belowOrEqual.length > 0
            ? belowOrEqual.reduce((best, a) => diffOf(a) > diffOf(best) ? a : best)
            : altsForPhrase.reduce((best, a) => diffOf(a) < diffOf(best) ? a : best);
        result.push(...chosen.Notes);

        // Top tier's slice for this range isn't used, but still mark it claimed so the
        // "notes outside every phrase" pass below doesn't duplicate it.
        for (const n of Notes) {
            if (n.TimeOffset >= start && n.TimeOffset < end) claimed.add(n);
        }
    }

    // Shouldn't normally happen (phrases are expected to cover the whole song), but don't
    // silently drop notes that fall outside every phrase's recorded range.
    for (const n of Notes) {
        if (!claimed.has(n)) result.push(n);
    }

    return result;
}
