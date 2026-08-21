# Engineering hygiene

General software-design principles, each demonstrated via a real bug hit in this codebase. See
[`README.md`](README.md) for how entries get routed here vs. elsewhere.

---

## Async work gated by a live state flag needs the callback to re-check too, not just the call site

An async operation started while a condition was true can resolve after that condition changes —
if the callback doesn't re-check the live state itself, it applies a stale result anyway. First
found in the now-removed `html2canvas` panel-capture pipeline: an idle-timeout overlay was
silently undone because a capture already in flight resolved after the panel went idle, and its
callback unconditionally applied the stale captured content.

**Fix:** re-check the live condition inside the callback itself, not just before starting the
async call.

---

## A codebase can have more than one loading path for "the" data model — find every producer/consumer

Threaded a new field through one loading path (`SongIndex.ts`) and assumed that was the data
model; the feature silently didn't work in-headset because a second, parallel manifest-based
loading path (`SongSource.ts`/`tools/bake-songs.ts`/`tools/song-server.ts`) never carried the
field. A clean typecheck doesn't catch a parallel path that independently builds the same shape.

**Fix:** when adding a field to a shared data model, trace every place that constructs the type,
not just the one found first.

---

## Audit what a reused "load everything" function actually needs before reusing it wholesale

Reused a full song-loading pipeline (including a new `SongPlayer` + full audio re-fetch/decode)
for a difficulty-only highway rebuild that never needed to touch audio at all — then had to build
pause/preserve-position/reseek logic to paper over a problem that the reuse itself created.
Splitting out just the audio-independent part (chart fetch + scene build) made the
interruption-avoidance logic unnecessary rather than something to work around.

---

## Before deleting any shared global state, grep every reader/writer, not just the files being touched

A planned cleanup (deleting the legacy `panelMesh`/`uiPanel`/`panelTex`/`resizePanel`/`xrButtons`
html2canvas pipeline once the last known consumer migrated to uikit) turned out to be unsafe — a
completely different screen, not the one being migrated in that pass, independently read/wrote the
same globals for its own UI. "No longer used by the screen I'm touching" is not the same claim as
"no longer used by anything."

**Fix:** grep the whole directory the global lives in for every reader/writer before deleting it,
not just the files in the current change.

---

## A "resolve and cache a resource" helper shouldn't also have a side effect only some callers want

A generic "poll until a resource resolves, cache it, run the callback" utility also flipped a
panel's `pointerEvents` to `'auto'` the first time it resolved — fine for the caller that meant to
show the panel, but it was also called by read-only paths that never meant to enable anything,
causing a still-hidden panel to become silently clickable.

**Fix:** keep resource-caching helpers free of side effects entirely — interactivity (or any other
side effect) should only ever be toggled by the explicit setter built for that purpose, never as a
byproduct of an unrelated read.

---

## Shared-module code can't rely on assets living next to mode-specific code

**Symptom:** `import pianoImageUrl from './assets/piano.png'` failed inside a shared scene-building
module because the file actually lived under a desktop-only assets folder.

**Fix:** Any asset a shared module imports must itself live somewhere the shared module can reach
(e.g. its own `src/shared/assets/`) — copy it there rather than reaching across into a
mode-specific directory, even if that's where the asset happened to originate.

---

## Tag each item with its source at load time, not at use time

**Why:** Once items from multiple sources are merged into one flat list, there's no reliable way
to look up which source an item came from unless it was stored upfront — matching back by some
derived key (e.g. folder path) at use time is fragile once two sources can produce colliding keys.

**Pattern:** Wrap each item with its originating source at the point where sources are merged
(`{ entry, source }`), and have all downstream code read `source` off the wrapper instead of
re-deriving or looking it up later.

---

## `Promise.allSettled`, not `Promise.all`, when independent sources shouldn't fail each other

Loading from several independent sources (e.g. a bundled library plus an optional remote one) with
`Promise.all` means one source being unreachable fails the entire load. `Promise.allSettled` keeps
each source independent — a failing one logs a warning while every other source's results still
come through.

---

## Precompute a cheap existence flag instead of probing for a resource at render time

**Pattern:** If an optional per-item resource's existence can be determined once at build/index
time (e.g. `hasArt: existsSync(path)`), store that flag on the item instead of having every
consumer either fire a pre-flight existence check or handle a runtime 404/`onerror`. The consumer
becomes a synchronous branch on the flag instead of an async or error-handling path.

---

## Recurring, inconsequential git noise from a file is a gitignore case, not a "check the diff" habit

`public/songs/manifest.json` and `public/ui/*.json` showed up "modified" almost every session that
touched `dev`/`build` (both regenerate them from source every run) — never a real change, always LF
vs. the repo's CRLF convention, but still costing a manual diff each time to confirm that. Once a
tracked file goes stale-and-harmless-yet-dirty on a recurring basis, the fix isn't reviewing it more
carefully before each commit — it's removing it from git's view entirely.

**Fix:** if a tracked file keeps showing up dirty for content that's regenerated, inconsequential to
diff, or not meant to be reviewed, gitignore it rather than re-verifying it's noise every time.

---

## A shared low-level render helper's hardcoded behavior silently applies to every caller, not just the one you're changing

**Symptom:** Adding a dark-edge outline to the fret-position divider lines also changed the
appearance of two unrelated hit/miss flash lines and the note-to-fretboard connector line.

**Root cause:** `drawFretVerticalLine` has four call sites (the fret grid, two flash-line uses, one
connector line); the outline was hardcoded inside the shared function body instead of being a
parameter, so every caller got it whether it wanted it or not.

**Fix:** Made the outline axis a parameter defaulting to "off," and only the intended call site
opts in. When changing a shared render primitive for one specific use, grep every call site before
assuming the change is scoped to the one you're looking at.

---

## A flow's own state machine needs explicit reset on every exit path, not just its normal completion path

A "back to Library" handler for an in-progress multi-step calibration flow hid the relevant panel
but never reset the flow's own `state` field — so the per-frame system driving that flow kept
running its full step logic (including a world-space label that tracked the user's hand) well
after the user had navigated away, until the next time the flow was properly restarted.

**Fix:** Any exit path that isn't the flow's own designed completion (a back/cancel/navigate-away
button, in particular) needs to explicitly reset whatever state the flow's per-frame update reads
— hiding the UI doesn't imply the logic driving it has stopped.
