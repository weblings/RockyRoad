# uikit/uikitml — pointer interaction

Ray/hand drag, hover, and capture gotchas. See [`INDEX.md`](INDEX.md) for the full ui-toolkit map.

---

## `Hovered` — a free, already-computed "is anything pointing at this" signal, worth reusing broadly

**Finding:** `@iwsdk/core`'s `state-tags.d.ts` exports `Hovered`, a transient tag `InputSystem`
automatically adds/removes on any `RayInteractable` entity while a ray *or* hand pinch intersects
it — the same mechanism already driving click routing, not something built for this. Checking
`entity.hasComponent(Hovered)` is a handful of component lookups, not a new raycast, so it's a
performant way to answer "is a hand/controller currently pointing at this thing" for purposes
unrelated to clicking — e.g. this project uses it to know when to un-hide hand-tracking visuals
while a song is playing (`HighwaySystem.update()` in `src/xr/index.ts`). Worth reaching for
whenever a feature needs "is the user interacting with panel X right now" without wanting to pay
for or duplicate raycasting that IWSDK's own input pipeline already does every frame regardless.

---

## Pointer-drag math: neither `.uv` nor `.localPoint` on the event can be trusted blindly — always `stableElement.worldToLocal(event.point)`

`event.uv` didn't track drag position reliably (unconfirmed why). `event.localPoint` is relative to
`intersection.object` — whichever sub-element was actually hit first — so its reference frame
silently shifts depending on exactly what the drag grabbed (fill bar vs. thumb vs. tick mark).
uikit's own scrollbar code (`scroll.js`'s `setupScrollHandlers`) avoids this the same way we should:
capture the stable container once and always use `container.worldToLocal(event.point.clone())`.

```ts
const track = doc.getElementById('as-seek-track');
const pointerFraction = (e) => {
    if (!e.point) return null;
    const local = track.worldToLocal(e.point.clone());
    return Math.max(0, Math.min(local.x + 0.5, 1)); // local space is centered: x=0 center, ±0.5 edges
};
```

**Coordinate convention:** local space is normalized and centered — `0` is the element's own
center, `±0.5` its edges (confirmed via `scroll.js`'s `getIntersectedScrollbarIndex`/
`computeScrollbarTransformation`), so `localX + 0.5` is the 0-1 fraction across an element's width.

---

## `setPointerCapture`/`releasePointerCapture` work for XR ray/hand drag — confirmed pattern for "grab and drag past the element's bounds"

`@pmndrs/pointer-events` implements real pointer capture (browser-standard semantics). Calling
`event.currentTarget.setPointerCapture(event.pointerId)` on pointer-down keeps `onPointerMove`/
`onPointerUp` firing even once the ray/hand leaves the element's bounds — without it, drag only
works while directly hovering, which feels broken for anything wider than a few cm. Confirmed with
both ray and hand-pinch. No built-in slider/scrubber component exists in `@iwsdk/*`/`@pmndrs/*` —
this capture + `worldToLocal` combo is the primitive to build one from.

**Reusable pattern** (`_wireSeekDrag()`/`_applyProgress()` in `XRActiveScene.ts`): capture a *grab
offset* on pointer-down so the element tracks relative to where you grabbed, not the raw cursor;
commit on pointer-up. Two refinements worth building in from the start for any scrubber: (1) a
quick pointer-down→up under ~200ms should jump straight to the tapped position (the plain
offset logic otherwise computes a no-op offset from the pre-existing value); (2) call the real
seek/update on every `onPointerMove`, not just a visual preview, so the user sees where release
will land instead of guessing from the bar alone.

---

## `pointerEvents` inherits down the tree, and a descendant's own explicit value always wins

`pointerEvents` is inherited (`properties/inheritance.js`), defaulting to `parent.pointerEvents ??
this.defaultPointerEvents`. Useful for disabling every *other* interactive element during a real
drag: flip the panel root to `'none'`, give the dragged element its own explicit
`pointer-events: auto;` in `.uikitml` to override it. Only toggle once a drag is *confirmed* (past
the movement threshold) — it's re-checked live on every raycast, so flipping it before a tap's
matching `pointerup` could change what object the release resolves to.
