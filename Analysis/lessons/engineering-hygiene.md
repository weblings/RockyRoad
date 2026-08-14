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
