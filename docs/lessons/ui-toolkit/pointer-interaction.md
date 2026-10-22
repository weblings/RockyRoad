# uikit/uikitml — pointer interaction

Id: lesson-uikit-pointer-interaction

Ray/hand drag, hover, and capture gotchas. See [`INDEX.md`](INDEX.md) for the full ui-toolkit map.

---

## `Hovered` — a free, already-computed "is anything pointing at this" signal, worth reusing broadly
Tags: hovered, ray-interactable, input, hand-tracking
Applies-when: needing to know whether a ray or hand is pointing at an entity

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
Tags: drag, worldToLocal, pointer-events, slider
Applies-when: computing drag position on a uikit element

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
Tags: pointer-capture, drag, scrubber, slider
Applies-when: building a drag/scrubber/slider interaction in XR

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
Tags: pointer-events, inheritance, drag
Applies-when: disabling other interactive elements during a drag

`pointerEvents` is inherited (`properties/inheritance.js`), defaulting to `parent.pointerEvents ??
this.defaultPointerEvents`. Useful for disabling every *other* interactive element during a real
drag: flip the panel root to `'none'`, give the dragged element its own explicit
`pointer-events: auto;` in `.uikitml` to override it. Only toggle once a drag is *confirmed* (past
the movement threshold) — it's re-checked live on every raycast, so flipping it before a tap's
matching `pointerup` could change what object the release resolves to.

---

## A custom slider needs a tall hit area and half-thumb margins on both ends
Tags: slider, thumb, hit-area, layout, overlap
Applies-when: building a slider or scrubber with a thin track and a circular thumb

A 0.8cm track is hard to ray-target, and a thumb centered on `position-left: 0%` or `100%` pokes half
its width past the track into whatever sits beside it (it covered the "Gain" label and value).

**Fix:** put the pointer handlers on a taller wrapper (2.4cm) that holds the track and thumb, and give
that wrapper left and right margins of half the thumb width. Use `worldToLocal` on the wrapper per the
drag-math entry above.

---

## A press stays captured on the card it started on, so releasing after a scroll drag still clicks that card
Tags: click, scroll, drag, pointer-capture, library
Applies-when: dragging to scroll a list of clickable cards opens a card on release

**Root cause:** uikit's scroll captures the pointer on the pressed child, so the release lands on that
same card and uikit synthesizes a click (it needs down and up on the same object). No `pointerleave`
fires mid-drag, the log showed `pu` always on the row where `pd` happened.

**Fix:** track hit-point travel from pointerdown in the card's own pointer handlers and swallow the next
click once it passed 1.5 cm (`DRAG_CLICK_THRESHOLD` in `XRSongLibrary.ts`). Use travel, not scroll
position, so a drag at the very end of the list, where position cannot change, is covered too.
