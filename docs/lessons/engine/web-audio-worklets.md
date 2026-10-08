# Engine — Web Audio AudioWorklet integration

Lessons from adopting `@soundtouchjs/audio-worklet` for pitch-preserving speed control
(`src/shared/SongPlayer.ts`; see `ThreeCP/Analysis/SoundTouchSpeedPlan.md` for the full phased
history). See [`INDEX.md`](INDEX.md) for the full engine map, and `runtime-apis.md`'s "A discarded
Web Audio object keeps playing unless explicitly stopped" for the closely related
`AudioBufferSourceNode` fact.

---

## Vite serves a worklet/wasm file an npm package ships via `?url` + a package subpath export — no manual `public/` copy needed

**Finding:** Assumed (from a prior sibling-project experience) that any library-internal file a
dev server needs to serve at runtime requires manually copying it into `public/`. Not true here —
the package published a subpath export (`"./processor"` in its `package.json` `exports`), and
Vite's `?url` import suffix resolved and served it automatically. Confirmed via `vite build`
emitting `soundtouch-processor-[hash].js` as its own hashed asset with zero extra config.

**How to apply:** Before assuming a manual asset-copy step is needed for a worklet/wasm file a
package ships, check whether the package exposes a subpath export for it and try `?url` first.

---

## Verify a third-party audio library's actual API surface — a wrapper can be shaped differently than the underlying algorithm's reputation suggests

**Finding:** Planned an integration around a `tempo` AudioParam based on general SoundTouch/WSOLA
family knowledge, before the package was ever installed. The actual installed
`@soundtouchjs/audio-worklet@2.1.1` has no such param — real mechanism is native
`source.playbackRate` (drives the actual speed change) mirrored onto `stNode.playbackRate` (tells
the processor what rate to compensate for), with internal pitch correction computed as
`pitch / playbackRate`. Confirmed by reading the actual `.dist/SoundTouchNode.d.ts` and the
processor's render-loop source, not just recalling how similar libraries are typically shaped.

**How to apply:** Read the installed package's actual type defs/source before finalizing an
integration design that predates installing it — prior knowledge of a library's algorithm family
doesn't guarantee its wrapper API matches.

---

## An AudioWorkletNode's internal DSP state goes stale on any discontinuity in its input stream — not just an explicit "seek"

**Finding:** Assumed only explicit user seeks needed special handling for a stateful worklet node's
internal buffering (WSOLA analysis windows, in this case). Tracing every resume path in the actual
code found plain pause→resume and resume-with-countdown hit the identical staleness risk, since
they all rebuild the upstream source node the same way a seek does — "seeking" was never the real
trigger, "a fresh upstream source" was.

**How to apply:** Pair a stateful worklet node's lifetime 1:1 with its ephemeral upstream source
node — rebuild both together, every time the source is rebuilt — rather than trying to enumerate
and special-case which specific user interactions "count" as a discontinuity.

---

## AudioParams reset to their default value on node (re)construction — sync explicitly, don't rely on a setter firing later

**Finding:** A freshly (re)constructed `SoundTouchNode`'s `playbackRate` AudioParam silently sits
at its default (`1.0`) until something explicitly sets it. Relying on the app's existing
rate-change setter to eventually correct it left a real window where a newly built node didn't
reflect already-selected application state (e.g. a non-default speed already chosen before this
particular node existed).

**How to apply:** Sync every AudioParam that reflects application state immediately after
constructing (or reconstructing) the node — don't assume the next unrelated setter call will catch
it up.

---

## Reassigning a node reference doesn't disconnect the old node from the graph

**Finding:** Replacing `this.stNode = new SoundTouchNode(...)` without first calling `.disconnect()`
on the outgoing instance leaves it permanently wired to `destination` — dropping the JS reference
alone doesn't sever the graph connection. Left unfixed, every pause/seek/resume over a session
would accumulate another orphaned worklet processor idling on silence.

**How to apply:** Explicitly `.disconnect()` the outgoing node before constructing and connecting
its replacement, any time a node gets rebuilt rather than reused for the life of the session.

---

## A worklet's own health-metrics API can cheaply distinguish "real buffer underrun" from "inherent algorithm quality ceiling"

**Finding:** Audio got audibly "crunchy" at extreme slow playback speeds. Before assuming that meant
buffer starvation needing a buffer-sizing fix, checked `SoundTouchNode.metrics`'s `underrunCount`
live during the exact complaint window — it stayed flat across several seconds of continuous
low-speed playback, ruling out an ongoing starvation problem and confirming the artifact was
WSOLA's known quality ceiling at extreme stretch ratios instead. Different root causes need
different (or no) fixes, and guessing wrong would have meant tuning buffer parameters that were
never the actual problem.

**How to apply:** When a real-time audio-worklet library exposes health/underrun metrics, check
them live during the complaint window before picking a fix — don't assume which of several
plausible causes is the real one.

---

## A cumulative metrics counter needs edge-detection, not a `> 0` check, or one blip logs forever

**Finding:** `SongPlayer.ts`'s underrun warning fired on `underrunCount > 0`. That counter never
resets per-node, so one brief early burst (e.g. right after a fresh `stNode` is built) kept
reprinting the same stale count on every subsequent `metrics` tick for the rest of playback —
indistinguishable from ongoing starvation without checking whether the count was actually still
climbing.

**How to apply:** Track the last-seen value and fire only on an increase
(`m.underrunCount > lastUnderrunCount`); also gate dev-diagnostic console output behind
`import.meta.env.DEV` so it doesn't ship to production users.
