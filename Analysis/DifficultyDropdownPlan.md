# Difficulty dropdown — detection & population plan

Status: planned, not started. Covers only *when to show* and *what options to populate* the
Difficulty dropdown on XR Song (PreScene) and Play (XRActiveScene) screens. Deliberately excludes
the chart-player work (actually resolving a selected difficulty into playable notes) — see
"Explicitly deferred" at the end.

Spans two repos: `MusicThingImport` (converter/C# side, produces the data) and this repo's
`ThreeCP/v2` (XR consumer side).

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
  spans, not phrase-scoped, since RB's tiers aren't phrase-authored. Separate follow-up, not
  required for this plan.
- `Techniques` note: real psarc output serializes technique flags as a comma-joined string
  (`"Chord, ChordNote"`), not the numeric bitmask `SongFormat.ts` assumes — already handled by
  `FretPlayerScene3D.ts`'s `normalizeTechniques()` shim, wired in before render. Not a blocker, but
  that shim only runs on the top-level `Notes` array — would need extending to `AlternateLevels[].Notes`
  once those are actually rendered (deferred, not this phase).

## Why `song.json` is the primary source, not the note file

`PsarcConverter.cs` would compute the available-difficulties list from `songAsset.Arrangements`
*before* the top-tier/alternate split, so it includes the hardest tier's own value. The note file's
`AlternateLevels` never records that value — it's discarded once a tier becomes the default `Notes`.
Confirmed hands-on: manually deriving the list from `bass.json`/`lead.json`/`rhythm.json`'s
`AlternateLevels` only ever recovers the sub-tiers (e.g. lead: 1–13), never the top tier. So
`song.json`'s field is the only *complete* source — not just the cheaper one.

## Data model changes

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
  and `AlternateLevels?: SongDifficultyLevel[]` on `SongInstrumentNotes` (needed later for actual
  resolution, but the type should exist since the data is already present in real note files).

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
- Prerequisite not covered by this plan: `song.uikitml` has no Difficulty (or Speed) dropdown
  markup at all yet — that pattern currently only exists in `play.uikitml`. Needs adding before this
  can render on Song.

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
  (needed later for resolution), only the label is normalized.
- This directly avoids the earlier concern (multiple percentage options resolving to the same
  underlying notes) — since options are now real per-song tiers rather than a universal fixed list,
  every displayed percentage corresponds to a genuinely distinct tier.

## Song → Play threading

- Small object (already decided over loose positional params, given `partName` threading was about
  to grow a second sibling): `{ partName: string; difficulty?: number }`, replacing the current
  plain `partName: string` threaded through `onPlay`/`onCalibratePlay`/`onReposition`/`loadSong`.
- `difficulty` is the raw selected integer level, not the percentage — Play recomputes its own
  percentage label from its own `availableDifficulties` for display, rather than trusting a
  precomputed label from Song (keeps one formatting rule, computed twice from the same source, not
  a label passed across the boundary).

## Explicitly deferred (not this plan)

- Per-phrase resolution: swapping in the correct `AlternateLevels` entry for a selected value at
  each phrase boundary during playback, including phrases whose own local max differs from the
  part's overall max.
- `normalizeTechniques()`-equivalent handling for `AlternateLevels[].Notes` (only matters once those
  notes are actually rendered).
- `RockBandConverter.cs`'s discard-tier fix (Easy/Medium/Hard → `AlternateLevels`, same shape as the
  psarc fix, whole-song-scoped instead of phrase-scoped).
- Actual `song.uikitml` markup for the Difficulty dropdown (Song-screen prerequisite noted above).
