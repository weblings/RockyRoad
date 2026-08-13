# Difficulty & Instrument dropdowns — XR Song/Play, with an eye on Desktop

Status: planned, not started. Started as detection/population for the XR Play Difficulty
dropdown; grew to cover Song's new Instrument dropdown and Song↔Play interplay once we looked at
what showing Difficulty on Song (not just Play) would actually require. Desktop already has some
of this solved — see "Desktop comparison" — so later phases lean on that rather than reinventing it.

## Phased approach

1. **Extract the shared dropdown class, proven on Play.** Pull `_wireOptionMenuScroll`/centering-
   on-open/trigger-label-recreate-node out of `XRActiveScene` into something reusable, validated by
   having Play's existing Speed dropdown keep working unchanged through it. **XR-only** — see
   "Desktop comparison," desktop has no equivalent need. Detail: see "Phase 1 detail" below.
2. **Difficulty detection + population, on Play.** The data-model and detection/population work
   below. Ends with a dropdown that shows real per-song percentage options and lets you select one
   — **selecting a value does not yet change played notes**, that's phase 5, not this phase.
3. **Song's Instrument dropdown, and reusing Difficulty there.** See "Song Instrument dropdown"
   below. Depends on (1) for the dropdown machinery and (2) for Difficulty already working
   somewhere first.
4. **`song.json`/Import changes** (`SongFormat.cs`, `PsarcConverter.cs`, MIDI converter mirrors).
   Deliberately last — (1)-(3) can be built and tested against a manually-edited test `song.json`
   (already done once, by hand, against `AmericanIdiot/song.json`), so the real converter pipeline
   isn't a blocker for any of them.
5. **Chart-player resolution** — per-phrase `AlternateLevels` swapping so a selected difficulty
   actually changes played notes. Depends on (2) and (4)'s data existing; doesn't strictly require
   (3). The natural close-out once the others land, not a prerequisite for any of them.

`RockBandConverter.cs`'s discard-tier fix (Easy/Medium/Hard → `AlternateLevels`, whole-song-scoped
instead of phrase-scoped) isn't phase-ordered above — it's independent, do it whenever convenient
around phase 4.

## Phase 1 detail — shared dropdown class

Re-read the current `XRActiveScene.ts` in full before drafting this (this session had a revert I
wasn't aware of until asked, so working from memory wasn't trustworthy). Confirmed there's no
warm-up-at-mount mitigation in the code today — the phase list above previously claimed otherwise,
now corrected.

**Instantiation shape: one instance per dropdown**, not one per screen managing several via keyed
Maps — confirmed preference. Each instance owns its own `menuOpen`/`menuWasOpen`/`triggerLabelNode`/
`scrollOffset`/drag state as plain fields, no Map indirection needed.

**What moves into the shared class, verbatim or near-verbatim** (all confirmed generic in the
current code — no Speed-specific logic inside any of these):
- `_wireOptionMenuScroll`'s full drag-to-scroll implementation (capture/release, tap-vs-drag via
  `DRAG_THRESHOLD`, `pointerEvents` disable-others-while-dragging).
- `_setOptionSelected`'s class-toggle helper.
- The trigger-label recreate-node pattern (currently `_setSpeedTriggerLabel` — destroy/recreate a
  `UIKit.Text` node in a slot rather than mutate `.text`).
- The centering-on-open formula, currently inlined in `_wireSpeedDropdown` (lines 291–297) —
  extract into its own function first, both because the class needs it and because it's the one
  piece of this whole thing that's pure math with no uikit/pointer-events dependency, worth its own
  test (see "Testing" below).

**What stays caller-supplied** (constructor config or per-render-call arguments, not owned by the
class):
- Element ids (trigger, chevron-down/up, menu, menu-inner, trigger-label-slot) — Speed's are
  `as-speed-*` today; Song's future Instrument/Difficulty dropdowns will have their own.
- The option list itself, and each option's `selected`/`onClick` — Speed's is a fixed 10-item list
  declared statically in `play.uikitml` (`as-speed-opt-20` … `as-speed-opt-200`, always present,
  just toggled).
  **Update from phase 2:** dynamic (runtime-created/destroyed) option lists were originally flagged
  here as deferred, phase-3-only work. That's done — `OptionDropdown.renderDynamic()` shipped in
  phase 2 for Play's Difficulty dropdown and is fully generic, not Difficulty-specific. Phase 3
  reuses it as-is for Instrument; no new dropdown machinery needed there.
- `songPlayer.playbackRate` / `SPEED_PRESETS` / `speedPercentLabel()` — Speed's own state and
  values, stay in `XRActiveScene`, passed to the shared instance rather than absorbed by it.

**Regression-safety property to preserve:** `play.uikitml` needs zero markup changes for phase 1 —
same ids, same structure, only the TS-side implementation moves. If that holds, in-headset behavior
should be identical before/after by construction, which is also most of the test plan.

### Testing

No automated headset visibility in this environment (established earlier in the project) — testing
is a mix of what can be checked without a headset and a manual in-headset regression pass.

**Without a headset:**
- `npx tsc --noEmit` after the refactor.
- Confirm `play.uikitml` has zero diff (or intentionally zero changes) — the strongest cheap signal
  that behavior shouldn't have shifted.
- Unit-test the extracted centering-math function in isolation (plain Node/`vitest`-style
  assertions, no uikit involved) — edge cases: first item selected, last item selected, nothing
  selected, item count small enough that `contentHeight < menuHeight` (no scrolling needed at all).
  This is the one piece of the class worth testing this way; everything else is fundamentally
  interaction-driven and can't be meaningfully exercised without real pointer events.

**In-headset regression checklist** (all of these already work today — the bar is "still true after
the refactor," not new functionality):
- Tap trigger opens/closes the menu; chevron swaps accordingly.
- Drag-scroll works in both directions inside the popover.
- A quick tap on an option selects it (doesn't get eaten as a micro-drag).
- A real drag doesn't accidentally register as a click on whatever option it started over.
- Reopening after selecting a non-default value (e.g. 100%) centers on that selection, not the top.
- Selecting a new value updates the trigger label without the label going stale/misaligned.
- Other panel elements don't receive stray hover/clicks while a drag is in progress.
- Selecting an option actually changes `songPlayer.playbackRate` — functional correctness, not just
  visual.
- The known-unresolved two-line-wrap glitch (see `UikitLessonsLearned.md`) should be **unchanged**
  in frequency/character, not better or worse — call this out explicitly so it isn't misattributed
  to the refactor either way if it's noticed during testing.

## Desktop comparison

Checked `src/desktop/ActiveSceneScreen.ts` and `PreSceneScreen.ts` directly — changes some
assumptions for later phases.

- **Speed is a native `<select>` on desktop**, not a custom popover, with a +/- stepper beside it.
  Confirms phase 1 (the shared dropdown class) is purely an XR concern — the entire reason that
  machinery exists (drag-scroll, capture/release bugs, z-fighting, the two-line-wrap glitch) is
  downstream of XR having no native dropdown primitive. Desktop sidesteps all of it for free; the
  two platforms will always have structurally different dropdown implementations, nothing to unify.
- **Desktop's `PreSceneScreen.ts` already has a real, working Instrument selector** — phase 3
  should mirror its shape, not design one from scratch:
  - Filters out Vocals before considering a default: `entry.parts.filter(p => p.type !== 'Vocals')`.
    XR doesn't do this today — a latent gap worth fixing independent of this whole effort.
  - Has a friendly-name map already: `PART_LABEL = { LeadGuitar: 'Lead', RhythmGuitar: 'Rhythm',
    BassGuitar: 'Bass', Keys: 'Keys', Drums: 'Drums' }`. Reuse or hoist this rather than
    re-inventing an XR-side version.
  - Tracks `private selectedPart: SongIndexPart` as live mutable class state, updated on click,
    read at Play-time — exactly the state-shape `XRPreScene` is missing (see below).
  - **Defaults differently than XR**: `entry.parts.find(p => p.type !== 'Vocals') ?? entry.parts[0]`
    — first playable part, full stop. XR's current logic specifically prefers Keys
    (`find(p => p.type === 'Keys') ?? entry.parts[0]`). Real behavioral discrepancy between
    platforms, not just an implementation detail — decide whether XR's Keys-preference is
    intentional or should be reconciled with desktop's simpler rule before building phase 3,
    rather than silently treating XR's version as correct.
- **Desktop has no Difficulty concept anywhere either** — confirms that half of this work is
  genuinely greenfield on both platforms. The data-model changes (`SongFormat.ts`/`SongIndex.ts`/
  C# converters, phases 2 and 4) aren't XR-specific work being done first and ported later — they
  benefit both platforms equally, neither has a head start there.

## Background

- `SongInstrumentNotes.AlternateLevels` (Rocksmith-style dynamic difficulty) already exists in
  real converted output (confirmed against `C:\Users\mewuz\Music\Charts\GreenDay\AmericanIdiot\lead.json`)
  but isn't in `ThreeCP/v2`'s `SongFormat.ts` yet. It's per-*phrase*, not per-song: the same
  phrase (`StartTime`/`EndTime`) recurs across multiple entries at different `Difficulty` integer
  levels, each a progressively simpler version of that phrase. There's no flat song-wide difficulty
  list in this data — the top-level `Notes` array is implicitly each phrase's own hardest/100% tier.
- MIDI-imported Keys songs never produce `AlternateLevels` (`BrowserPianoMidiConverter`'s
  `PIANO_MIDI_ANALYSIS.md` explicitly deferred difficulty generation). So detection naturally
  evaluates false for Keys until/unless that's built later — no special-casing needed.
- Rock Band-style MIDI difficulty (`RockBandConverter.cs`'s `EFretsOnFireDifficulty` Easy/Medium/
  Hard/Expert, octave-encoded) is detected today but everything below Expert is discarded at the
  final emit gate (`if (... && difficulty == EFretsOnFireDifficulty.Expert)`). Same fix shape as
  psarc: keep Expert as default `Notes`, push the other three into `AlternateLevels` — whole-song
  spans, not phrase-scoped, since RB's tiers aren't phrase-authored.
- `Techniques` note: real psarc output serializes technique flags as a comma-joined string
  (`"Chord, ChordNote"`), not the numeric bitmask `SongFormat.ts` assumes — already handled by
  `FretPlayerScene3D.ts`'s `normalizeTechniques()` shim, wired in before render. Not a blocker, but
  that shim only runs on the top-level `Notes` array — would need extending to `AlternateLevels[].Notes`
  once those are actually rendered (phase 5, not before).

## Why `song.json` is the primary source, not the note file

`PsarcConverter.cs` would compute the available-difficulties list from `songAsset.Arrangements`
*before* the top-tier/alternate split, so it includes the hardest tier's own value. The note file's
`AlternateLevels` never records that value — it's discarded once a tier becomes the default `Notes`.
Confirmed hands-on: manually deriving the list from `bass.json`/`lead.json`/`rhythm.json`'s
`AlternateLevels` only ever recovers the sub-tiers (e.g. lead: 1–13), never the top tier. So
`song.json`'s field is the only *complete* source — not just the cheaper one.

## Data model changes (phases 2 & 4)

**`MusicThingImport/Dependencies/OpenSongChart/SongFormat/SongFormat.cs`**
- `SongInstrumentPart` gets `AvailableDifficulties: List<float>` (matches `SongDifficultyLevel.Difficulty`'s
  float type). Not a bool, not a count — the actual distinct values, so population can be built
  directly from them.

**`MusicThingImport/PsarcChartCore/PsarcConverter.cs`**
- Same per-part method that already assigns `SongDifficulty` (~line 122-129) sets
  `AvailableDifficulties = songAsset.Arrangements.Select(a => a.Difficulty).Distinct().ToList()`.
  Free — precedes the phrase loop, no extra iteration.

**`MusicThingImport/BrowserPianoMidiConverter/src`**
- No logic change needed for the psarc download path — `main.ts` already spreads `_psarcResult.SongData`
  wholesale into `song.json`, so a new C#-side field flows through automatically.
- `songformat.ts`'s `SongInstrumentPart` mirror needs `AvailableDifficulties?: number[]` added, for
  type accuracy only (not required for the JSON bytes themselves).
- MIDI path (`buildSongInfo()`) needs no change — Keys parts never have this data, omitting the
  field is already correct, same convention `SongDifficulty` already follows.

**`ThreeCP/v2/src/shared/SongFormat.ts`**
- Add `AvailableDifficulties?: number[]` to `SongInstrumentPart`.
- Add `SongDifficultyLevel { Difficulty: number; StartTime: number; EndTime: number; Notes: SongNote[] }`
  and `AlternateLevels?: SongDifficultyLevel[]` on `SongInstrumentNotes` (needed for phase 5, but the
  type should exist now since the data is already present in real note files).

**`ThreeCP/v2/src/shared/SongIndex.ts`**
- Add `availableDifficulties?: number[]` to `SongIndexPart`.
- `entryFromJson()` must map `p.AvailableDifficulties` through explicitly — this function does a
  narrow field-by-field mapping (not a passthrough spread), so anything not explicitly added here
  is silently dropped. This is the load-bearing site for Song-screen detection.

## Detection + population — Song (PreScene)

- `XRPreScene._render()`, alongside the existing `selectedPart` resolution: read
  `selectedPart.availableDifficulties`. Non-empty → show the dropdown.
- No fallback fetch here — `song.json` is already fully read for every song during the Library's
  initial scan (`SongIndex.ts`'s `scan()`), before the user ever opens a specific song, so this
  costs nothing new. Fetching the full note file just to check would be the actual new cost, and is
  deliberately avoided.
- Requires phase 3's markup and Instrument-dropdown work — Song's Difficulty options depend on
  which instrument is currently selected, so this can't ship as a static, always-on control the way
  Play's can.

## Detection + population — Play (XRActiveScene)

- Primary source: the same `AvailableDifficulties` field, read off the `songInfo` that `loadSong()`
  in `index.ts` already re-fetches from `song.json` (for `SongLengthSeconds`) — complete list, no
  new fetch cost.
- Fallback only for stale/un-reconverted files (missing the field): compute
  `(instrumentNotes.AlternateLevels?.length ?? 0) > 0` as a show/hide-only signal — the note file is
  already being loaded for rendering regardless, so this is free, but incomplete (missing the
  untracked top tier) until that song gets reconverted. Degrades to "dropdown shows, options are
  short by one" rather than "dropdown missing entirely."
- Replaces the current hardcoded `DIFFICULTY_ENABLED = false` const in `XRActiveScene.ts` — becomes
  a per-song value threaded through `show()`/`_render()`, same pattern as `songTitle`/`artUrl`/etc.

## Population — shared logic

- Options come directly from `availableDifficulties`, not a fixed preset ladder (e.g. not a
  Speed-style hardcoded `[0.2, 0.4, ...]`) — a song with N real tiers shows N options, never more
  than actually exist.
- Each raw integer value gets a **percentage label** for display:
  `round(value / max(availableDifficulties) * 100)%` — matches the original "float under the hood,
  displayed like '100%'" framing. The underlying stored/selected value stays the real integer
  (needed for phase 5's resolution), only the label is normalized.
- Real per-song tiers (not a universal fixed list) means every displayed percentage corresponds to
  a genuinely distinct tier — no two options ever resolve to the same underlying notes.

## Song → Play threading

- Small object, replacing the current plain `partName: string` threaded through
  `onPlay`/`onCalibratePlay`/`onReposition`/`loadSong`: `{ partName: string; difficulty?: number }`.
- `difficulty` is the raw selected integer level, not the percentage — Play recomputes its own
  percentage label from its own `availableDifficulties` for display, rather than trusting a
  precomputed label from Song (keeps one formatting rule, computed twice from the same source, not
  a label passed across the boundary).
- The object shape already accounts for Instrument — `partName` was always part of it, phase 3 just
  makes it user-selected instead of computed once. What phase 3 actually adds on top: `XRPreScene`
  needs to *hold* that state live (see below), not just pass a freshly-computed value through.

## Song Instrument dropdown — complexity findings (phase 3)

- **Depends on phase 1** for the actual dropdown interaction machinery — none of it exists on
  `XRPreScene` today. Already satisfied: `OptionDropdown.renderDynamic()` (shipped phase 2) is
  generic, Instrument needs no new dropdown machinery, just two more instances.
- **Calibration lookup needs to react to instrument changes.** `tryLoadCalibration(selectedPart.type)`
  is keyed by type (`'Keys'` vs. everything else), not by specific part — switching within the
  guitar family (Lead/Bass/Rhythm) is cheap (same calibration), but switching between a Keys part
  and a Guitar part changes calibration type entirely and has to re-derive `hasSavedCal`, which
  currently drives whether `ps-recal` shows at all and which callback `ps-play` wires to.

All three open questions this section originally raised (default-instrument rule, cross-dropdown
Difficulty behavior, visual layout) are now settled — see "Phase 3 detail" below.

## Phase 3 detail — Song's Instrument + Difficulty dropdowns

### Decisions (settled)

- **Default-instrument rule, shared by XR and desktop** (explicit ask: keep the two platforms
  consistent, not XR-only): `Settings.lastInstrumentType` (if the current song has a part of that
  type) → Keys (if present) → Lead (if present, among Lead/Rhythm/Bass) → first playable part.
  Written whenever the user actually starts playing (`onPlay`/`onCalibratePlay`), not on mere
  dropdown selection. This **replaces** desktop's current `entry.parts.find(p => p.type !==
  'Vocals') ?? entry.parts[0]` rule too, not just XR's Keys-preferring one — both platforms call
  the same resolver function.
- **Cross-dropdown (Instrument → Difficulty)**: when Instrument changes, retarget Difficulty to the
  option in the *new* part's list whose rank/count ratio is closest to the old selection's
  percentage (e.g. 60% selected on a 5-tier part → nearest rank on an 8-tier part is
  `round(0.6×8)=5th` ≈ 62%), not a hard reset to 100%.
- **Layout**: top — single back button (not Play's 3-item nav bar). Center — `.song-row` (art-thumb
  + song-meta, ported from `play.uikitml`) directly above `.option-row` (Instrument + Difficulty),
  both centered, replacing `.song-info`'s hero layout (6.4×6.4 art, 2cm title). Bottom — existing
  `.actions` bar (Reposition/Play), unchanged.

### Concrete changes

**`src/shared/Settings.ts`**
- Add `lastInstrumentType: string | null` to `Settings`, default `null`.

**`src/shared/SongIndex.ts`** (gap found during investigation — phase 2's data-model list called
for this and it was never actually done)
- Add `availableDifficulties?: number[]` to `SongIndexPart`.
- `entryFromJson()` must map `p.AvailableDifficulties` through — narrow field-by-field mapping, not
  a passthrough spread, so this is silently dropped otherwise.

**New shared resolver** (`src/shared/` — exact filename TBD at implementation time)
- The default-instrument chain above, as one function both `XRPreScene.ts` and desktop's
  `PreSceneScreen.ts` call, taking `(entry: SongIndexEntry, lastInstrumentType: string | null) =>
  SongIndexPart`.
- Hoist `PART_LABEL` (currently `src/desktop/PreSceneScreen.ts:7`, desktop-only) alongside it —
  XR's Instrument dropdown needs the same friendly-name map.

**`src/desktop/PreSceneScreen.ts`**
- Swap its own default-rule inline expression for a call to the shared resolver, so both platforms
  actually share behavior rather than just having similar-looking separate rules.
- Write `Settings.lastInstrumentType` at the same play-start points XR does.
- **Not in scope for phase 3**: desktop gets no Difficulty UI here — desktop has no Difficulty
  concept anywhere yet (see "Desktop comparison"), and this phase only wires the shared default
  rule + persistence, not a new desktop control. A future phase, if wanted.

**`src/xr/XRPreScene.ts`**
- Becomes stateful: `_selectedPart`/`_selectedDifficulty` fields (replacing the fresh-every-render
  `entry.parts.find(...)`), two `OptionDropdown` instances (Instrument, Difficulty — same
  constructor shape as `XRActiveScene`'s).
- Instrument selection triggers the cross-dropdown Difficulty retarget above.
- `tryLoadCalibration`/`hasSavedCal` re-derives whenever `_selectedPart` changes, not just once per
  mount.
- Calls the shared resolver for the initial default; writes `Settings.lastInstrumentType` in
  `onPlay`/`onCalibratePlay`, mirroring desktop.

**`ui/song.uikitml`**
- Replace `.song-info`'s hero layout with `.song-row`/`.art-thumb`/`.song-meta` +
  `.option-row`/`.option-dropdown`/`.option-trigger`/`.option-menu`/`.option-item` etc., hand-copied
  from `play.uikitml` (no `@import` mechanism — same convention every other screen already follows).
  Two `.option-dropdown` blocks (Instrument always shown, Difficulty gated exactly like Play's via
  `.option-dropdown-gated` + a `display` toggle based on `selectedPart.availableDifficulties`).
- `.header`/`.back-btn` stay as-is (already just the back button — no nav-bar simplification needed
  here, unlike Play).
- `.actions`/`.action-btn` stay as-is.

### Testing

Same split as phase 1 — no automated headset visibility in this environment.

**Without a headset:**
- `npx tsc --noEmit`.
- Validate `public/ui/song.json` the same way as every prior screen (diff markup classes against
  compiled `classes` keys, grep for bare shorthand leftovers).
- Unit-testable in isolation: the shared default-instrument resolver (pure function, no uikit) and
  the nearest-percentage-rank retarget math — both good candidates for the same
  plain-Node-assertions treatment `computeCenteredOffset()` got.

**In-headset regression + new-behavior checklist:**
- Existing Reposition/Play flow (touch-calibrate, fine-tune, playback) unchanged for a
  single-instrument song (e.g. Keys-only) — the bar is "still true after," matching phase 1's
  framing.
- Instrument dropdown shows all playable parts (Vocals excluded), selects/highlights correctly,
  updates the trigger label.
- Switching Instrument on a song with saved Keys calibration but no Guitar calibration correctly
  flips `ps-recal` visibility and which callback `ps-play` wires to.
- Switching Instrument retargets Difficulty to the nearest percentage, not always back to 100%.
- Difficulty dropdown hidden entirely when the selected part has no `AvailableDifficulties`.
- Opening a song with a previously-used instrument type (`Settings.lastInstrumentType`) defaults to
  that part, not Keys/Lead, when that type exists on this song.
- Opening a song with no matching `lastInstrumentType` falls back correctly: Keys if present,
  otherwise Lead if present, otherwise first playable part.
- Desktop regression: `PreSceneScreen.ts`'s existing part-selection buttons still work, and its
  default now matches the shared rule (verify against a song where desktop's old rule and the new
  shared rule would actually pick different parts, e.g. one with a saved `lastInstrumentType` from
  a prior XR session).

## Explicitly deferred to phase 5

- Per-phrase resolution: swapping in the correct `AlternateLevels` entry for a selected value at
  each phrase boundary during playback, including phrases whose own local max differs from the
  part's overall max.
- `normalizeTechniques()`-equivalent handling for `AlternateLevels[].Notes` (only matters once those
  notes are actually rendered).

## Follow-up (not phase-ordered): `SongDifficulty` fallback in library sort

`SongIndex.ts:108` maps `difficulty: Number(p.SongDifficulty ?? 0)`, consumed by desktop
`SongLibraryScreen.ts`'s difficulty-asc/desc sort. `SongDifficulty` (confirmed still real, not
vestigial — added upstream in `OpenSongChart` by a third-party contributor, predates this project)
is a flat per-song value and can be absent even when `AvailableDifficulties` is populated, which
currently sorts those songs to the bottom regardless of actual difficulty. Fallback: when
`SongDifficulty` is missing, derive from `AvailableDifficulties` (e.g. its max) instead of `0`. No
fallback needed in the reverse direction — `SongDifficulty` is a single number, not a set of
selectable tiers, so it can't stand in for `AvailableDifficulties` anywhere (e.g. the Play dropdown
gate, which correctly just hides when the list is empty).
