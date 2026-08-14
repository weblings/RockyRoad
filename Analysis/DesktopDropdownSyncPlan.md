# Desktop dropdown sync — porting XR's Instrument/Difficulty UX to Desktop

Status: planned, not started. Follow-up to `DifficultyDropdownPlan.md` (now deleted, fully
implemented — its three loose ends live in `MusicThingImport/TODO.md` now). That plan explicitly
deferred desktop's own Difficulty UI to "a future phase, if wanted" — this is that phase, scoped
as its own plan since it's really a separate effort (porting/generalizing an existing XR feature
to a structurally different UI toolkit — DOM, not uikit — rather than new feature design).

## Goal

Desktop's Song and Play screens get the same Instrument/Difficulty selection XR already has,
using desktop's own DOM/CSS rather than porting uikit. All the underlying logic — default-part
resolution, cross-dropdown percentage retargeting, difficulty-to-notes resolution — is already
shared (`src/shared/InstrumentSelect.ts`, `DifficultyDisplay.ts`, `DifficultyResolve.ts`); this
plan is UI plumbing on top of code that already exists and works.

## Decisions (settled)

- **Dropdown visual style: generalize Library's existing custom trigger+menu pattern**
  (`.lib-sort-trigger`/`.lib-sort-menu`/`.lib-sort-option`), not native `<select>`. Its color
  tokens already match XR's `.option-trigger`/`.option-menu`/`.option-item` almost exactly (same
  `#333333`/`#1a1a1a`/`#2a2a2a`/`#515151`/`#242424`/`#c8c8c8` values) — this is the closer visual
  match to XR and to the rest of this app's dark theme; native `<select>`'s popup layer can't be
  restyled to match either.
- **Outside-click-to-close is a known, pre-existing gap** in both Library's dropdown today and
  XR's `OptionDropdown` (independently noticed in both). **Deferred to Phase E below, applied to
  desktop first, then ported to XR** — not part of Phases A-D. Today's "no overlap" behavior is a
  byproduct of menus rendering directly under their own non-overlapping triggers, not an enforced
  rule — Phases A-D just need to preserve that spatial separation, not build the real fix yet.
- **No new Settings persistence for Difficulty** — matches XR: only `Settings.lastInstrumentType`
  persists; Difficulty is carried Song→Play per-session via constructor params only.
- **Play never gets an Instrument dropdown** — instrument choice is Song-only on both platforms.
- **A difficulty change on Play fully resets note-detection state** (`NoteDetector` recreated
  against the rebuilt scene, same open mic reused) — there's no persistent score anywhere to lose,
  only per-note highway hit/miss coloring, and the underlying note sequence can change per-phrase
  across the whole song, not just locally, so there's no meaningful "partial" carry-over.

## Phased approach

Ordered so the shared plumbing (A) lands and is proven before anything is built on top of it —
same methodology `DifficultyDropdownPlan.md` used for XR's `OptionDropdown` extraction (prove the
shared class via an existing dropdown that must keep behaving identically, before using it for
anything new).

1. **Phase A — shared `Dropdown` helper + generalized CSS**, proven by refactoring Library's Sort
   dropdown onto it.
2. **Phase B — Song's Instrument + Difficulty dropdowns**, built on Phase A.
3. **Phase C — Song→Play piping** (`selectedDifficulty` threaded through constructors). Pure
   plumbing; only loosely depends on B, could land in parallel.
4. **Phase D — Play's Speed + Difficulty dropdowns**, plus the difficulty-triggered highway
   rebuild. Depends on A and C.
5. **Phase E, deferred to the end — outside-click/sibling-close fix**, desktop's `Dropdown` first,
   then ported to XR's `OptionDropdown`.

## Phase A detail — shared `Dropdown` helper

New file: `src/desktop/Dropdown.ts`. One instance per dropdown (matches XR's `OptionDropdown`
shape), built via DOM methods (`createElement`/`append`), not `innerHTML` string rebuilding for
the option list — avoids wiping other event listeners on rerender, matches the existing convention
already used for section ticks (`ActiveSceneScreen.ts`) and `speedSelect`'s options.

```ts
export interface DropdownOption { label: string; value: string; selected: boolean }

export class Dropdown {
    // Static registry — unused until Phase E, but costs nothing to add now and means the later
    // close-pass fix needs zero changes to this class, just one document-level listener.
    private static instances: Dropdown[] = [];

    constructor(container: HTMLElement, onSelect: (value: string) => void) { /* builds trigger+chevron+menu once into container */ }
    setTriggerLabel(text: string): void { /* ... */ }
    setOptions(options: DropdownOption[]): void { /* destroy+recreate menu items, same pattern as XR's renderDynamic() */ }
    close(): void { /* ... */ }
    get isOpen(): boolean { /* ... */ }
}
```

`value` is always a string (DOM convention, matches `speedSelect.value`) — callers parse back to
`number` where needed (Difficulty values, Speed rates).

**CSS**: rename `.lib-sort-dropdown`/`.lib-sort-trigger`/`.lib-sort-chevron`/`.lib-sort-menu`/
`.lib-sort-option` to a screen-agnostic family (`.dropdown`/`.dropdown-trigger`/
`.dropdown-chevron`/`.dropdown-menu`/`.dropdown-option`) in `desktop.html`'s `<style>` block —
these were Library-prefixed only because Library was the only user; four more dropdowns are about
to exist across two other screens. Grep `SongLibraryScreen.ts` for every `.lib-sort-*` reference
(both in the template string and in `querySelector` calls) when renaming.

**Regression-safety proof**: refactor `SongLibraryScreen.ts`'s Sort dropdown to use the new
`Dropdown` class, deleting its bespoke open/close/select wiring. If Sort behaves identically after
(same trigger/menu/hover/selected behavior, same outside-click gap — not fixed yet, that's Phase
E), the class is trustworthy for Phases B and D's new dropdowns.

### Testing

- `npx tsc --noEmit`.
- Manual regression: Library's Sort dropdown — trigger opens/closes menu, selecting an option
  updates the trigger label and re-sorts, selected-state highlighting matches the chosen option.
  Behavior should be identical to before the refactor, not improved (outside-click gap included).

## Phase B detail — Song's Instrument + Difficulty dropdowns

`src/desktop/PreSceneScreen.ts`:
- Replace `.pre-parts` (pill-button row) with two `Dropdown` instances, positioned in the existing
  vertical stack.
- Visibility: Instrument shown only if `playableParts.length > 1`; Difficulty shown only if
  `selectedPart.availableDifficulties?.length > 0` — same gating as `XRPreScene._render()`.
- Add `selectedDifficulty: number | null` alongside the existing `selectedPart` field.
- Switching Instrument retargets Difficulty via `nearestRankForPercentage()` (already in
  `DifficultyDisplay.ts`) — same logic as `XRPreScene._selectInstrument()`, not a reset to 100%.
- `commitInstrument()` unchanged (only ever touches `lastInstrumentType`).

### Testing

- Manual: Instrument dropdown lists all playable parts (Vocals excluded), selecting one updates
  the trigger label and (if applicable) retargets Difficulty. Difficulty dropdown hidden entirely
  for parts with no `availableDifficulties` (e.g. Keys). Existing Tune/Play flow unaffected for a
  single-instrument song.

## Phase C detail — Song→Play piping

- `ActiveSceneScreen`'s constructor gains `selectedDifficulty: number | null = null`.
- `TunerScreen`'s constructor gains the same param, forwarded on its `'song-flow'` exit case
  (`TunerScreen.ts:349-353`) into the `ActiveSceneScreen` it constructs. The `'mid-song'` context
  never reconstructs `ActiveSceneScreen`, so it needs no change (confirmed unused today regardless
  — no call site constructs `TunerScreen` with `'mid-song'` yet).
- Both `PreSceneScreen.ts` call sites (`#pre-tune`, `#pre-play`) pass `this.selectedDifficulty`
  through.
- `ActiveSceneScreen.ts:111`'s existing `resolveNotesForDifficulty(instrumentNotes, null)` call
  drops the hardcoded `null` in favor of the constructor param — this line was already written
  anticipating exactly this.

### Testing

- Manual: pick a non-default Difficulty on Song, confirm Play's highway renders the resolved note
  set for that value (cross-check against the same song/value combination already validated on
  XR), not the top-tier default.

## Phase D detail — Play's Speed + Difficulty dropdowns, and the highway rebuild

`src/desktop/ActiveSceneScreen.ts`:
- Replace `.speed-group` (the `[−] [select] [+]` compound) with a `Dropdown` for Speed, sized to
  match the surrounding bar controls (`.active-back-btn`/`.active-play-btn` heights — exact
  padding TBD at implementation time). Add a Difficulty `Dropdown` next to it, shown only when
  `part.availableDifficulties?.length > 0` — mirrors `as-difficulty-dropdown`'s gating in XR,
  naturally hidden for Keys.
- **Highway rebuild on difficulty change — simpler than XR's `buildGuitarHighway()`**: XR
  re-fetches all three JSON files from scratch on every difficulty change because `index.ts`'s
  closures don't hold the raw fetched objects between calls. `ActiveSceneScreen` is a class
  instance, so it keeps `songStructure`/`instrumentNotes`/`instrumentPart` as private fields after
  the first fetch in `mount()`. A difficulty change then only needs to: re-run
  `resolveNotesForDifficulty()` on the notes already in memory, `this.scene?.destroy()` the old
  scene, construct a new `FretPlayerScene3D` with the re-resolved notes, reapply the existing
  settings block from `mount()`, set `currentSecond = this.songPlayer.currentSecond`, update
  `this.sections`, and swap `this.app.activeScene`. Zero re-fetch, `songPlayer`/audio never
  touched — no pause/reseek logic needed at all, same reasoning that motivated splitting
  `buildGuitarHighway()` out on the XR side in the first place.
- Recreate `NoteDetector` against the new scene after rebuild, reusing the existing
  `pitchDetector`/mic stream (`ownsPitchDetector` untouched) — same shape as the initial-mount
  detection setup, just called again.

### Testing

- `npx tsc --noEmit`.
- Manual: Speed dropdown replaces the stepper with no loss of function (still drives
  `songPlayer.playbackRate`). Difficulty dropdown hidden for Keys, shown with correct percentage
  options for Guitar/Bass. Selecting a new Difficulty mid-play rebuilds the highway with **no
  audio interruption** (song keeps playing through the swap, no seek/pause/flicker) and correct
  new note set. Note-detection resumes cleanly against the new note set (no crash from stale
  `notesDetected` array length mismatch).

## Phase E (deferred to the end) — outside-click / sibling-close fix

Desktop first: one `document`-level click listener using `Dropdown`'s static `instances` registry
— close any open dropdown whose root doesn't contain the click target, and have each trigger's
open-handler close sibling dropdowns first. Once proven working on desktop's four (five, counting
Library) instances, port the same shape to XR's `OptionDropdown` (no static registry there today —
would need the equivalent, plus a uikit-appropriate "outside click" signal instead of DOM's native
one).

## Execution checklist (not yet done)

- [ ] Phase A: `src/desktop/Dropdown.ts`, CSS rename, Library Sort refactored onto it.
- [ ] Phase B: Song's Instrument + Difficulty dropdowns.
- [ ] Phase C: Song→Play `selectedDifficulty` piping (`PreSceneScreen`/`TunerScreen`/`ActiveSceneScreen`).
- [ ] Phase D: Play's Speed + Difficulty dropdowns, highway rebuild, `NoteDetector` recreation.
- [ ] Phase E: outside-click/sibling-close fix, desktop then XR.
