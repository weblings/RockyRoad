# Difficulty & Instrument dropdowns — XR Song/Play, with an eye on Desktop

Status: planned, not started. Started as detection/population for the XR Play Difficulty
dropdown; grew to cover Song's new Instrument dropdown and Song↔Play interplay once we looked at
what showing Difficulty on Song (not just Play) would actually require. Desktop already has some
of this solved — see "Desktop comparison" — so later phases lean on that rather than reinventing it.

## Phased approach

1. **Extract the shared dropdown class, proven on Play.** Pull `_wireOptionMenuScroll`/centering-
   on-open/trigger-label-recreate-node/warm-up-mitigation out of `XRActiveScene` into something
   reusable, validated by having Play's existing Speed dropdown keep working unchanged through it.
   **XR-only** — see "Desktop comparison," desktop has no equivalent need.
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

- **Visual port is cheap.** `play.uikitml`'s `.song-row` (art-thumb + song-meta, `#1a1a1a`
  background, `0.6` radius) is close to a verbatim copy into `song.uikitml`, replacing Song's
  current large-centered-art `.song-info` treatment. That current treatment is a hero layout (6.4×6.4
  art, 2cm title) — swapping in the compact card plus an option-row is a real visual redesign, not
  a mechanical resize; how much of the freed vertical space goes to what is an open design call.
- **Depends on phase 1** for the actual dropdown interaction machinery — none of it exists on
  `XRPreScene` today.
- **Instrument itself is new UI, but not new logic** — desktop's `PreSceneScreen.ts` already has
  the selection logic, default rule, and `PART_LABEL` map (see "Desktop comparison"); port the
  shape rather than design fresh. Still need to decide the Keys-preference-vs-first-playable-part
  discrepancy before implementing.
- **Cross-dropdown dependency (Instrument → Difficulty) is new interaction, not a stability risk.**
  Nothing today depends on it, so building it doesn't threaten existing behavior — but there's no
  existing pattern to copy either. Play's Speed/Difficulty are independent of each other; nothing
  else in this codebase has one dropdown's options depend on another's live selection. Real open
  question: what happens to Difficulty's current selection when Instrument changes — reset to that
  part's own default (100%), or try to preserve the same percentage if the new part supports it?
- **`XRPreScene` needs to become stateful.** Today it recomputes a best-guess part fresh on every
  `show()` call with no persisted selection — no analog to `XRActiveScene`'s `_speedMenuOpen`/
  `_optionMenuScrollOffsets` fields. Needs its own version of that shape so click handlers read live
  selection state instead of a value recomputed at render time. Desktop's `selectedPart` field is
  the reference for what this should look like.
- **Calibration lookup needs to react to instrument changes.** `tryLoadCalibration(selectedPart.type)`
  is keyed by type (`'Keys'` vs. everything else), not by specific part — switching within the
  guitar family (Lead/Bass/Rhythm) is cheap (same calibration), but switching between a Keys part
  and a Guitar part changes calibration type entirely and has to re-derive `hasSavedCal`, which
  currently drives whether `ps-recal` shows at all and which callback `ps-play` wires to.
- **Naive default, cheap to ship first**: Instrument reuses XR's existing `selectedPart` resolution
  logic unchanged (pending the Keys-vs-first-playable decision above); Difficulty defaults to the
  max value in `availableDifficulties` (100%, no reduction) — same "safe default" role Speed's 100%
  already plays. Neither requires the cross-dependency behavior to be decided to ship an initial
  working version; that behavior only matters once the user actually changes Instrument mid-session.

## Explicitly deferred to phase 5

- Per-phrase resolution: swapping in the correct `AlternateLevels` entry for a selected value at
  each phrase boundary during playback, including phrases whose own local max differs from the
  part's overall max.
- `normalizeTechniques()`-equivalent handling for `AlternateLevels[].Notes` (only matters once those
  notes are actually rendered).
