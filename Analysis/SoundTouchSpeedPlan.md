# Pitch-preserving speed control — adopting SoundTouch

## Goal

Replace `SongPlayer`'s speed implementation so changing playback speed no longer shifts pitch,
using `@soundtouchjs/audio-worklet` (already installed: `package.json`'s
`@soundtouchjs/audio-worklet@^2.1.1`). `ISongPlayer`'s public shape doesn't change — confirmed
both `ActiveSceneScreen.ts` (desktop) and `XRActiveScene.ts` (XR) use the identical surface
(`play`/`pause`/`seekTo`/`currentSecond`/`isPlaying`/`playbackRate` get+set), never reach around
the interface to touch Web Audio internals, and `SongPlayer`'s `AudioContext` is already private
with no external references — so this whole effort stays inside `SongPlayer.ts`, zero changes to
either screen. `SilentPlayer` (no-audio charts) is untouched either way.

## Decisions (settled)

- **Corrected from an earlier draft of this plan:** the installed `@soundtouchjs/audio-worklet@2.1.1`
  has no `tempo` AudioParam. Confirmed directly from `.dist/SoundTouchNode.d.ts` (only `pitch`,
  `pitchSemitones`, `playbackRate` are exposed) and `SoundTouchProcessorBase.js`'s render loop:
  `this._pipe.pitch = (pitch * 2**(pitchSemitones/12)) / playbackRate`. The intended usage is the
  opposite of what was first assumed: let **native** `source.playbackRate` do the actual speed
  change (exactly what `SongPlayer.ts` already does today), and mirror that same value onto
  `stNode.playbackRate`. The processor then divides its internal pitch correction by that value,
  canceling the pitch shift the native rate change introduces — net effect is speed changes, pitch
  doesn't. `stNode.pitch`/`pitchSemitones` stay at their defaults (`1.0`/`0`) throughout; they're
  for deliberate transposition, not tempo compensation.
- **`source.playbackRate` keeps being the value driven by `ISongPlayer.playbackRate`** — unchanged
  from today's Option A. The only new state is mirroring that same value onto `stNode.playbackRate`
  whenever it's set.
- **Keep the `playbackRate` property name on `ISongPlayer`/`SongPlayer`** — its meaning and the
  value it's set to don't change at all, only that a second node now mirrors it. Update the doc
  comment (already says "Option A changes pitch; Option B will not" — flip to describe the shipped
  behavior).
- **Timing formula (`currentSecond = pausedAt + elapsedRealTime × playbackRate`) needs no
  hypothesis-confirmation in Phase C** — `source.playbackRate` is identical to today by
  construction, so the formula that already reads it is unaffected. (Worklet lookahead latency is
  still a separate, real concern — still deferred to Phase E, see below.)
- **Graceful degradation:** if `audioWorklet.addModule()` fails (unsupported browser, blocked
  module load), fall back to today's plain `source → destination` graph (no `stNode`) rather than
  breaking playback entirely. Cheap to add, avoids a hard dependency on the worklet loading
  successfully.
- **Performance (XR/Quest CPU budget), quality at the extreme presets (0.2x especially — WSOLA is
  known to degrade toward "flamming"/stutter on transients past roughly 4x/0.25x), and the
  worklet's inherent lookahead latency's effect on highway sync are explicitly deferred to Phase E
  (assess once the implementation works), not design-blocking now.** See prior investigation in
  this session for the sourced findings behind each.

## Phased approach

Ordered so the highest-uncertainty, cheapest-to-check piece (does the worklet module even load in
our build) lands first, before any playback-graph rewiring depends on it.

### Phase A — Worklet asset pipeline + module registration

- The package exposes a documented Vite-native path — `@soundtouchjs/audio-worklet/processor?url`
  resolves to the correct served URL via Vite's `?url` import convention, no manual `public/` copy
  step needed (confirmed against this project's installed Vite 7.3.6, and against the package's own
  README, which documents this exact case). Use `SoundTouchNode.register(context, processorUrl)`
  (static method, wraps `audioWorklet.addModule()`) once per `AudioContext`, awaited before any
  `SoundTouchNode` is constructed.
- Prove it in isolation: construct a `SoundTouchNode` against `SongPlayer`'s existing
  `AudioContext` and confirm no load/registration errors — before wiring it into the real
  playback graph. Cheapest possible checkpoint for "does this work in our setup at all."

**Testing:** `npx tsc --noEmit`. Manual: load a song, confirm the worklet module registers with no
console errors (playback graph itself untouched yet).

### Phase B — Rewire the playback graph, prove parity at 1.0x

- `stNode` and `source` have different lifetimes — `stNode` is constructed once per `loadSong()`
  (Phase A), but `play()` creates a fresh `AudioBufferSourceNode` on every call, including every
  `seekTo()` (which stops the old source and calls `play()` again). So the graph change is two
  separate edits, not one:
  - `stNode.connect(this.context.destination)` — **once**, right after `this.stNode = new
    SoundTouchNode(...)` in `loadSong()`.
  - In `play()`, replace `this.source.connect(this.context.destination)` with a fallback-aware
    connect: `if (this.stNode) this.source.connect(this.stNode); else
    this.source.connect(this.context.destination);` — this is also where the graceful-degradation
    fallback from Decisions actually gets implemented (Phase A only left `stNode` `null` on
    failure; nothing reads that yet).
- Right after constructing `stNode` in `loadSong()`, also set
  `this.stNode.playbackRate.value = this._playbackRate`. The setter only writes to `stNode` when
  it's *called* — if `_playbackRate` is ever non-default before `stNode` exists, the AudioParam
  would otherwise sit at its default `1.0` until the next Speed change, silently skipping pitch
  compensation on first playback. Today's two call sites (`ActiveSceneScreen.ts`,
  `XRActiveScene.ts`) happen to only allow Speed changes after `loadSong()` resolves, so this isn't
  an active bug, but that safety is implicit and coupled across two files — make it explicit here
  since it costs one line.
- `playbackRate` setter keeps `source.playbackRate.value = rate` and additionally sets
  `stNode.playbackRate.value = rate` (mirror, new line) so the processor's internal pitch
  compensation matches.
- Deliberately do **not** verify pitch-preservation yet — this phase is purely "does audio still
  sound correct and unchanged at the default 1.0x speed" through the new graph shape, isolating
  graph-wiring mistakes from speed-logic mistakes. At 1.0x the mirrored value is `1.0` either way,
  so this phase can't yet tell working pitch-compensation apart from a no-op — that's Phase C.

**Testing:** Manual: play a song at default speed through the new graph, confirm audio is
identical to before (no added latency/glitches/volume change perceivable at 1.0x).

### Phase C — Real speed changes, confirm pitch preservation

- No source changes — Phase B's setter mirrors every rate unconditionally (it doesn't branch on
  the value), so non-1x rates already flow through both `source.playbackRate` and
  `stNode.playbackRate` exactly like 1.0x did in Phase B's test. This phase is pure verification.
- Confirm pitch genuinely stays constant by ear at a few presets (e.g. 0.6x, 1.4x) — the actual
  point of this whole effort. (Our approach — native `source.playbackRate` driving speed,
  `stNode` only correcting pitch — is also the pattern the package's own README recommends
  specifically to avoid audible gaps at higher speeds from the worklet's small per-block buffer;
  a `tempo`-only approach would have risked that, ours shouldn't.)
- Sanity-check the note highway / seek bar stays in sync with the audio at non-1x speeds (the
  `currentSecond` formula itself isn't expected to need changes, per Decisions above, but the
  worklet does add processing latency that could show up as drift even with the formula correct).
  If it drifts, note it, but don't rabbit-hole into compensating for it yet (that's Phase E's job
  if it turns out to matter).

**Testing:** Manual, in both desktop and XR: change speed mid-playback via the existing Speed
dropdown (no UI changes needed — same control, new backend), confirm pitch is stable and the
highway stays synced. **Confirmed** (both desktop and XR): pitch stays correct across the whole
tested range; audio quality itself degrades into "crunchy" WSOLA artifacts at ~40% and below
(pitch still correct even then), clean at 60%+ and at 200%. Matches the WSOLA-degradation risk
flagged in Decisions — feeds directly into Phase E's extreme-preset assessment, not a Phase C
regression.

### Phase D — Seek and rate-change robustness

- **The trigger isn't "a seek" — it's "`play()` building a fresh `source`," which happens on every
  resume path, seek or not.** Traced all of them in `ActiveSceneScreen.ts`/`XRActiveScene.ts`:
  plain pause→resume, resume-with-countdown (`onSongRollback`'s `seekTo()` while stopped, then
  `onSongResume`'s `seekTo()` + `play()`), and click-to-seek/scrub-release (`seekTo()` calling
  `play()` itself) all funnel through the identical fresh-`AudioBufferSourceNode`-construction
  branch in `play()`. None of them is a special case — whatever `stNode` has buffered/analyzed
  internally (WSOLA lookahead) goes stale relative to a new source stream regardless of *why* that
  source is new.
- **Fix: pair `stNode`'s lifetime 1:1 with `source`'s, not with the song's.** Move `stNode`
  *construction* out of `loadSong()` into `play()`'s buffer branch, right alongside where `source`
  itself is constructed — a fresh `stNode` is built every single `play()` call, unconditionally.
  `loadSong()` keeps doing the one-time-per-`AudioContext` worklet *module registration*
  (`SoundTouchNode.register()` — that part genuinely is one-time), but stops holding a persistent
  node. This removes any need to reason about which resume paths count as "a jump" — there's no
  cross-segment state to go stale if nothing ever crosses a segment boundary.
- **Two implementation details this surfaces, absent from earlier phases:**
  - The old `stNode` needs an explicit `.disconnect()` before being replaced — reassigning the
    field alone doesn't sever its connection to `destination`; left alone, every pause/seek over a
    session accumulates another orphaned worklet processor idling on silence.
  - The construct → connect → sync-`playbackRate` sequence (the same one-time dance Phase B added
    in `loadSong()`) now runs on every `play()` call instead of once — pull it into one small
    private helper so it isn't duplicated, and so the "sync the AudioParam explicitly, don't rely
    on the setter alone" gotcha from Phase B doesn't need re-solving here.
- Confirm changing `stNode.playbackRate`/`source.playbackRate` **without** a source rebuild (a
  live speed change mid-playback, no pause/seek involved) does not need node recreation — they're
  real `AudioParam`s, a plain value change should be sufficient; verify this rather than assuming
  it, since it's the one case that genuinely doesn't go through `play()`.

**Testing:** Manual, in both desktop and XR: (1) seek via the seek bar, both click-to-seek and
drag-scrub, at 1.0x and a non-1x speed — confirm no stale-audio artifacts and `currentSecond` lands
correctly after each; (2) plain pause then resume with **no** seek in between — same check, this is
the path most likely to get skipped if only the seek bar is tested; (3) resume-with-countdown —
confirm unchanged behavior end to end.

### Phase E — Assess the deferred concerns, now that it works

- **XR/Quest CPU cost:** profile in-headset with a song playing, compare against pre-change
  baseline — is there measurable frame-time impact from the worklet running continuously
  alongside the highway rendering.
- **Quality at extreme presets:** listen specifically at 0.2x and 1.8x–2.0x for the
  transient-doubling/"flamming" artifacts WSOLA is known to produce toward the edges of its
  range. Decide whether the existing 0.2x–2.0x range needs trimming, or is acceptable as-is.
- **Lookahead latency:** if Phase C didn't already surface a sync issue, do a more deliberate check
  (e.g. a percussive/attack-heavy note) for a perceptible gap between highway and audio.

Only after this phase should any mitigation work (range trimming, latency compensation, a
fallback to Option A at extreme presets) be scoped — deliberately not designed preemptively.

## Execution checklist

- [x] Phase A: worklet asset pipeline + module registration, proven in isolation. `SongPlayer.ts`
      registers `@soundtouchjs/audio-worklet/processor?url` and constructs an unconnected
      `SoundTouchNode` in `loadSong()`, guarded with a try/catch fallback. `npx tsc --noEmit` and
      `npx vite build` both clean — build emitted `soundtouch-processor-[hash].js` as its own
      asset, confirming Vite's `?url` resolution works with no manual `public/` copy step, as the
      package's README promised. In-browser console-error check (dev server, load a song) still
      needs a manual pass before calling this fully done.
- [ ] Phase B: playback graph rewired, 1.0x parity confirmed.
- [x] Phase C: real speed changes wired, pitch stability and highway sync confirmed. No source
      changes needed (Phase B's mirroring is unconditional). Confirmed by ear, desktop + XR: pitch
      stays correct at every tested speed; audio itself gets "crunchy" (WSOLA artifacts) at ~40%
      and below, clean at 60%+ and 200% — expected, feeds Phase E, not a regression.
- [ ] Phase D: seek/rate-change robustness, existing pause/resume/scrub flows re-verified.
- [ ] Phase E: performance, extreme-range quality, and latency assessed; mitigations (if any)
      scoped as follow-up, not built preemptively.
