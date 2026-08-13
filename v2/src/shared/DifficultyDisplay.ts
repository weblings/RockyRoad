// Pure Difficulty display/retarget math, shared by XR's Play and Song dropdowns today and
// intended for desktop's eventual equivalent (see ThreeCP/Analysis/DifficultyDropdownPlan.md) —
// kept here rather than in src/xr/OptionDropdown.ts so desktop can reuse it without reaching into
// XR-only code, same reasoning as PART_LABEL/resolveDefaultPart living in InstrumentSelect.ts.

// rank/count, not raw value/max — raw Difficulty values are an arbitrary per-song scale that can
// start at 0, which would otherwise show the easiest option as a misleading "0%". 1-based rank
// keeps the displayed range (0%, 100%] instead of [0%, 100%].
export function difficultyOptionLabel(rank: number, count: number): string {
    return `${count > 0 ? Math.round((rank / count) * 100) : 100}%`;
}

// Trigger label only — options use difficultyOptionLabel (bare percent, no prefix).
export function difficultyPercentLabel(rank: number, count: number): string {
    return `Difficulty: ${difficultyOptionLabel(rank, count)}`;
}

// Song's "Phase 3 detail": when Instrument changes, retarget Difficulty to the option in the new
// part's list whose percentage is closest to the old selection's, rather than resetting to 100%.
export function nearestRankForPercentage(oldRank: number, oldCount: number, newCount: number): number {
    if (newCount <= 0) return 0;
    const fraction = oldCount > 0 ? oldRank / oldCount : 1;
    return Math.min(newCount, Math.max(1, Math.round(fraction * newCount)));
}
