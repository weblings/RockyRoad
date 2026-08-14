# uikit/uikitml — panel visibility and lifecycle

Show/hide, interactivity gating, and multi-panel coordination gotchas. See [`INDEX.md`](INDEX.md)
for the full ui-toolkit map.

---

## Hiding a `PanelUI` panel needs two separate gates, not just `visible = false`

`Object3D.visible = false` hides rendering only — clicks still land and the ray cursor still snaps
to it. Two independent systems don't consult `visible`: uikit's own click dispatch (governed by
`pointerEvents`) and IWSDK's ray-cursor targeting (driven by the `RayInteractable` component).

**Fix:** also do `entity.removeComponent(RayInteractable)` + `doc.rootElement.setProperties({
pointerEvents: 'none' })` (and the reverse to re-enable) alongside toggling `visible`.

---

## uikit has no native `disabled` attribute — fake it with a class

**Finding (from Song/PreScene's Play button):** there's no equivalent of HTML's `disabled` on
uikit buttons. The working substitute is a `.disabled` class combining `pointer-events: none`
(blocks clicks) with a dimmed `opacity` (signals the state visually), toggled via
`classList.add`/`remove` the same contains()-guarded way as any other state class (see the
`classList.remove()` warning entry in `syntax-and-styling.md`). See `.disabled` in
`ui/song.uikitml` and `_setDisabled()` in `XRPreScene.ts`.

---

## `pointerEvents: 'auto'` set before the panel's `PanelDocument` exists silently no-ops forever

A `PanelUI` panel rendered and registered ray hits, but nothing on it ever reacted to clicks —
permanently. Cause: the two-gate show function read `panelEntity.getValue(PanelDocument,
'document')` synchronously and called `doc?.rootElement.setProperties({ pointerEvents: 'auto' })`
— a silent no-op if `doc` is still `null` because the panel's async `fetch()` hasn't resolved, and
nothing ever retries. First hit on Library, the first screen shown at boot.

**Fix:** set `pointerEvents: 'auto'` from *inside* the doc-ready poll callback, where `doc` being
real is guaranteed by construction, not from an external caller hoping it's ready. Other screens
have the same theoretical race but never hit it since they show well after boot — apply this fix
proactively to any future panel shown early, don't wait for a bug report.

---

## A differently-sized panel needs its Y offset solved from the bottom-edge gap, not copied from same-slot siblings

**Symptom:** A panel visually overlaps/clips into the grab bar it's attached to.

**Root cause:** Settings/Song/Play/Calibration are all a fixed 0.4m × 0.3m, centered at local
Y = 0.169 on their shared parent (`grabBarEntity`) — chosen so a 0.3m-tall panel's *bottom edge*
sits 0.019m above the bar (`0.169 - 0.3/2`). Library is taller (0.525m, for its 3-column grid) and
initially reused the same 0.169 center offset, which pushed its bottom edge to
`0.169 - 0.525/2 ≈ -0.094` — below the bar, physically overlapping it.

**Fix:** When a panel's height differs from its same-slot siblings, solve for the center offset
that preserves the same *bottom-edge* gap, not the same center Y: center offset = (desired
bottom-edge gap) + (this panel's own height / 2), re-derived per panel, not copied.

---

## A "show a loading state" update can be dead code if it targets a panel that's already hidden by the time it fires

**Symptom:** Planned to replace `uiPanel.innerHTML = 'Loading'` with an equivalent overlay on a new
uikit panel.

**Root cause:** Traced the actual call sites first and found the functions that would trigger it
only ever fire as callbacks from a *different* screen that has already hidden the panel in
question by that point. The replacement would have been exactly as invisible as the original (which
updated a mesh's texture already hidden behind the other screen) — the original had the same latent
dead-code problem, it just degrades silently instead of erroring.

**Fix:** Dropped the loading-overlay markup and wiring entirely rather than ship a cleaner-looking
copy of the same non-functional code.

**How to avoid next time:** Before porting a "show a loading state" update, trace every call site of
the function that triggers it — the panel it updates may not be the one visible when it runs.

---

## A panel shown from multiple independent entry points needs its "hide every sibling" logic centralized in the callee, not assumed handled by the caller

Two panels z-fought after hardcoding a sibling-hide at just one `index.ts` call site for
`CalibrationSystem`'s panel — wrong layer, since that panel is triggered from three independent
places (PreScene/Play HUD Reposition, first-time calibration) and no single caller could be trusted
to know to hide siblings for the others.

**Fix:** move "hide every other panel, show mine" into the callee that actually knows it's about to
show a panel (`CalibrationSystem._showPanel()`), not into any one external caller.

---

## A completion callback can be a lightweight rerender instead of a full screen rebuild — restoration must match the completion shape, not be assumed generic

A panel hidden to show a temporary one stayed permanently invisible after the flow finished. Cause:
two structurally-identical-looking call sites (`CalibrationSystem`'s `recalibrate` vs.
`showCalibrationFineTune`) actually differ in what `onComplete()` does — one's a full screen
rebuild that re-establishes visibility from scratch, the other's a lightweight in-place rerender
that never touches panel `.visible` at all.

**Fix:** wrap the specific completion callback to explicitly restore hidden-panel visibility before
forwarding to the real `onComplete` — don't assume the caller's completion path will fix it. Two
call sites that look the same aren't necessarily interchangeable.

---

## When there's no real confirmation step to offer, skip the panel entirely rather than showing one for consistency

Guitar/Bass calibration has no physical instrument to touch-calibrate against — placement is always
the same deterministic camera-forward drop, for both first-time calibration and every later
reposition. It previously showed a "Grab the bar to reposition" confirm-and-Done screen out of
habit, matching Keys' shape, even though there was never anything to actually confirm. Removing the
confirm screen entirely (place the bar, save, call `onComplete()`, done — no panel, no doc lookup,
no button wiring) simultaneously fixed a visible-panel-flashing bug reported for Guitar's
Reposition (nothing to hide when no panel ever shows) and deleted an entire now-provably-dead
method and uikitml section. Worth checking for this shape generally: a "confirmation" screen that
never actually has anything for the user to decide is a candidate for deletion, not preservation.

---

## A callee that hides siblings via `.visible` alone is only safe because every caller happens to also disable interactivity itself

**Symptom:** Play HUD stayed fully clickable, invisible, underneath the calibration panel — a full
coincident overlap, not just a near-miss.

**Root cause:** `CalibrationSystem._showPanel()` toggled only `.visible` on sibling panels — it had
no access to their real interactivity setters (`RayInteractable` + `pointerEvents`), because only
its own setter was ever exposed on `world.globals`. Worked everywhere except one caller (Play HUD's
Reposition button) that only ever disabled `.visible` itself, assuming `_showPanel()` would handle
the rest.

**Fix:** Expose every sibling's real interactivity setter the same way, and have the callee call
them directly rather than trusting that whichever caller invoked it already did so — a callee that
can enforce its own invariant shouldn't depend on every caller remembering to.
