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

- **Use `SoundTouchNode.tempo`, not `.rate` or native `AudioBufferSourceNode.playbackRate`.**
  `tempo` changes speed with pitch held constant — the actual goal. `rate` reproduces today's
  pitch-shifting behavior; native `playbackRate` is today's Option A. The source node's own
  `playbackRate` stays at `1.0` always; `SoundTouchNode.tempo` becomes the single place speed is
  driven from.
- **Keep the `playbackRate` property name on `ISongPlayer`/`SongPlayer`**, even though it'll now
  drive `tempo` internally rather than native rate. Renaming would touch both screens' call sites
  for no functional benefit — the whole point of the interface boundary was to avoid that. Update
  the doc comment (already says "Option A changes pitch; Option B will not" — flip to describe
  the shipped behavior) rather than the name.
- **Timing formula (`currentSecond = pausedAt + elapsedRealTime × playbackRate`) is expected to
  carry over unchanged** — `tempo` is defined the same way as rate (output-duration ÷
  input-duration), so the existing analytic formula should still hold. Treated as a hypothesis to
  confirm in Phase C, not re-derived from scratch.
- **Graceful degradation:** if `audioWorklet.addModule()` fails (unsupported browser, blocked
  module load), fall back to today's native-`playbackRate` behavior rather than breaking playback
  entirely. Cheap to add, avoids a hard dependency on the worklet loading successfully.
- **Performance (XR/Quest CPU budget), quality at the extreme presets (0.2x especially — WSOLA is
  known to degrade toward "flamming"/stutter on transients past roughly 4x/0.25x), and the
  worklet's inherent lookahead latency's effect on highway sync are explicitly deferred to Phase E
  (assess once the implementation works), not design-blocking now.** See prior investigation in
  this session for the sourced findings behind each.

## Phased approach

Ordered so the highest-uncertainty, cheapest-to-check piece (does the worklet module even load in
our build) lands first, before any playback-graph rewiring depends on it.

### Phase A — Worklet asset pipeline + module registration

- Get `@soundtouchjs/audio-worklet`'s processor file served as a static asset. Likely needs
  copying into `public/` (Vite dev server won't serve library-internal files via a normal
  `import`, same category of issue already hit with the sibling project's psarc `dotnet.js`
  loading, and documented in `ThreeCP/Analysis/lessons/engine/dev-environment.md`) — confirm the
  exact mechanism (static copy step vs. a Vite plugin) once looking at the package's actual dist
  layout.
- Write a small loader that calls `audioContext.audioWorklet.addModule(url)` once per
  `AudioContext`, awaited before any `SoundTouchNode` is constructed.
- Prove it in isolation: construct a `SoundTouchNode` against `SongPlayer`'s existing
  `AudioContext` and confirm no load/registration errors — before wiring it into the real
  playback graph. Cheapest possible checkpoint for "does this work in our setup at all."

**Testing:** `npx tsc --noEmit`. Manual: load a song, confirm the worklet module registers with no
console errors (playback graph itself untouched yet).

### Phase B — Rewire the playback graph, prove parity at 1.0x

- Change `SongPlayer`'s graph from `source → destination` to
  `source → SoundTouchNode → destination`, source `playbackRate` pinned at `1.0`.
- `playbackRate` setter now sets `stNode.tempo.value = rate` instead of
  `source.playbackRate.value = rate`.
- Deliberately do **not** touch anything else yet (seek, `currentSecond`) — this phase is purely
  "does audio still sound correct and unchanged at the default 1.0x speed" through the new graph
  shape, isolating graph-wiring mistakes from speed-logic mistakes.

**Testing:** Manual: play a song at default speed through the new graph, confirm audio is
identical to before (no added latency/glitches/volume change perceivable at 1.0x).

### Phase C — Real speed changes, confirm the timing hypothesis

- Wire actual non-1x `playbackRate` values through to `stNode.tempo`.
- Confirm pitch genuinely stays constant by ear at a few presets (e.g. 0.6x, 1.4x) — the actual
  point of this whole effort.
- Confirm `currentSecond`'s existing formula still keeps the note highway / seek bar in sync with
  the audio at non-1x speeds, per the Decisions section's hypothesis. If it drifts, that's the
  worklet's lookahead latency showing up sooner than expected — note it, but don't rabbit-hole
  into compensating for it yet (that's Phase E's job if it turns out to matter).

**Testing:** Manual, in both desktop and XR: change speed mid-playback via the existing Speed
dropdown (no UI changes needed — same control, new backend), confirm pitch is stable and the
highway stays synced.

### Phase D — Seek and rate-change robustness

- Seeking today just restarts a fresh `AudioBufferSourceNode` at the target offset. With a
  `SoundTouchNode` in the chain, its internal WSOLA analysis-window state goes stale after a jump
  — seeking needs to recreate the `SoundTouchNode` alongside the source, not just the source
  alone.
- Confirm changing `.tempo` **without** a seek (a live speed change mid-playback) does not need
  the same node-recreation treatment — it's a real `AudioParam`, so a plain value change should be
  sufficient; verify this rather than assuming it.
- Re-verify the existing pause / resume-with-countdown / scrub-seek flows (`ActiveSceneScreen.ts`
  and `XRActiveScene.ts` already drive these through the unchanged `ISongPlayer` surface) still
  behave correctly through the new graph — this is regression-proofing existing behavior, not new
  design.

**Testing:** Manual: seek via the seek bar (both click-to-seek and drag-scrub) at both 1.0x and a
non-1x speed, confirm no stale-audio artifacts and `currentSecond` lands correctly after each.
Confirm pause/resume-with-countdown still works unchanged.

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

- [ ] Phase A: worklet asset pipeline + module registration, proven in isolation.
- [ ] Phase B: playback graph rewired, 1.0x parity confirmed.
- [ ] Phase C: real speed changes wired, pitch-stability and sync hypothesis confirmed.
- [ ] Phase D: seek/rate-change robustness, existing pause/resume/scrub flows re-verified.
- [ ] Phase E: performance, extreme-range quality, and latency assessed; mitigations (if any)
      scoped as follow-up, not built preemptively.
