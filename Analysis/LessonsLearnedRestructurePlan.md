# Lessons-learned restructure plan

Status: planned, not started. `ThreeCP/Analysis/UikitLessonsLearned.md` (679 lines, 45 entries) and
`ThreeCP/Analysis/LessonsLearned.md` (233 lines, 21 entries) work as content but aren't reliably
*discovered* — the only thing pointing at them is a `MEMORY.md` one-liner, which depends on me
correctly pattern-matching a terse description against the current task and then choosing to read a
long file. Skills are a more deterministic trigger (shown in a dedicated system-reminder listing
every session, designed specifically to be checked against the current task). This plan splits the
content into a directory tree small enough to load only the relevant piece, with skills as the
reliable entry point.

## The razor

Two organizing questions, applied in order, plus a tie-break rule for the entries that don't sort
cleanly:

1. **Technology/API surface** is the primary (directory-level) split — "what system does this fact
   concern." Stable over time: a fact like "uikitml has no CSS shorthand" is always a uikit-syntax
   fact regardless of what I was doing when I hit it.
2. **Activity/task-type** is the secondary (file-level) split within each directory — e.g.
   `ui-toolkit/scrolling-and-dropdowns.md`, `ui-toolkit/text-rendering.md`. This is the shape that
   actually matches how a task gets framed ("I'm about to build a dropdown").
3. **Failure-mode/archetype** (silent failure, timing race, unresolved) is *not* a directory — it's
   a cross-cutting shape, better served by scanning entry titles than by a third parallel hierarchy.
4. **Tie-break for cross-cutting entries:** file under whichever system *constrains the fix*, not
   whichever system exhibited the symptom. Example: "`THREE.Sprite` crashes IWSDK's pointer system"
   goes under IWSDK, because the fix is "don't use `THREE.Sprite` in an IWSDK-managed scene graph" —
   IWSDK is what's forcing the avoidance, not something wrong with `Sprite` itself. Cross-list the
   entry under multiple headings in that directory's `INDEX.md` if genuinely two-sided — the content
   lives in exactly one file, only the index entry is duplicated.

A third category doesn't fit the technology razor at all: entries that are really about *my own*
verification/reliability habits (not code or design), and entries that are general software-design
principles that only happen to have a codebase-specific example attached. These get pulled out of
the tech-surface split entirely — see "Process split" below.

## Process split (the entries that aren't tech-surface lessons)

- **Sub-category A — general software-design lessons, demonstrated via a real bug here.** Not
  really about me, not about a specific library — code-design wisdom that needs its concrete example
  to stay legible. Stays in the repo, in a new `lessons/engineering-hygiene.md` (small enough not to
  need its own directory).
- **Sub-category B — my own verification/reliability habits, no code-design content.** About how
  reliably *I* investigate and remember things, identical regardless of which project I'm working on.
  Moves to persistent cross-session memory as `feedback_*` entries, pruned from the repo entirely.

## Target tree

```
ThreeCP/Analysis/lessons/
  README.md                       # the razor + decision checklist, see below
  engineering-hygiene.md          # process sub-category A, no directory needed at this size
  ui-toolkit/
    INDEX.md
    syntax-and-styling.md
    text-rendering.md
    panels-visibility-lifecycle.md
    scrolling-and-dropdowns.md
    pointer-interaction.md
    assets-tooling-debugging.md
  engine/
    INDEX.md
    runtime-apis.md                # IWSDK / Three.js / Web Audio third-party API facts
    xr-3d-rendering.md             # this project's own 3D/XR rendering & math internals
    dev-environment.md             # Windows/dev-server/debugging setup & technique
```

`CLAUDE.md` gets its `LessonsLearned.md` pointer updated to point at `lessons/README.md` instead.

## Entry-by-entry disposition

### `lessons/ui-toolkit/` (34 entries, from `UikitLessonsLearned.md`)

**`syntax-and-styling.md`**: uikitml shorthand fails silently (merge the later "single-value
shorthand is NOT safe either" correction into this same entry, they're the same finding refined) ·
flex containers need explicit `display`/`flex-direction` · button centering must be the flex trio,
not `text-align` · `classList.remove()` warns if class not present · `border-radius` numeric-only,
not `50%` · no CSS Grid, flexbox only · `UIKit.Image`/`Text`/`Container` share one constructor shape
· `class="foo"` with no matching rule compiles silently.

**`text-rendering.md`**: `inter` font, specific weights only · text-burst corrupts unrelated
element's layout · missing-glyph character set keeps growing · no system keyboard reachable
(follow-up, not yet built — flag: this is a TODO, not a retrospective lesson; consider relocating to
a project plan/TODO doc instead of lessons-learned, low priority) · empty element never becomes
updatable via `setProperties({text})` · multi-styled string = two spans, each needing placeholder
text · `whiteSpace` doesn't control wrapping, `wordBreak` does · unresolved cross-subtree wrap
corruption (status: unresolved, shelved).

**`panels-visibility-lifecycle.md`**: two-gate panel hiding (`visible` + `RayInteractable` +
`pointerEvents`) · uikit has no native `disabled`, fake with a class · `pointerEvents: 'auto'` set
before `PanelDocument` exists silently no-ops forever · differently-sized panel needs Y-offset solved
from bottom-edge gap, not copied · "loading state" update can be dead code if panel already hidden ·
panel shown from multiple entry points needs centralized hide logic in the callee · completion
callback shape mismatch (lightweight rerender vs. full rebuild) · skip confirmation panel when
there's nothing to confirm · callee hiding siblings via `.visible` alone only safe if every caller
also disables interactivity itself.

**`scrolling-and-dropdowns.md`**: `overflow: scroll` needs `flex-shrink: 0` + explicit scrollbar
width/color · `overflow: hidden` didn't clip an absolutely-positioned sibling (unresolved, reverted)
· `overflow: scroll` + `flex-wrap: wrap` works · `overflow: scroll`'s pointer capture/release check
different objects, wedging capture · dropdown needing fixed + variable-length option lists splits
into `render()`/`renderDynamic()` sharing one private tail · analytic viewport-height fix for
last-item-clipped scroll bug didn't work (unresolved) · runtime-created option node doesn't inherit
a `<button>` markup class's default alignment.

**`pointer-interaction.md`**: `Hovered` — free, already-computed "is anything pointing at this"
signal · pointer-drag math needs `stableElement.worldToLocal(event.point)`, not `.uv`/`.localPoint` ·
`setPointerCapture`/`releasePointerCapture` pattern for XR ray/hand drag · `pointerEvents` inherits
down the tree, descendant's own explicit value always wins.

**`assets-tooling-debugging.md`**: `<img src="....svg">` is the safe way to embed a real SVG ·
`.uikitml` → JSON fetched once per page load, no cache-busting · no missing-image placeholder element
needed, just hide the `<img>` · SVG `fill="currentColor"` breaks uikit's image loader.

### `lessons/engine/` (15 entries, from `LessonsLearned.md`)

**`runtime-apis.md`**: IWSDK `OneHandGrabbable` uses squeeze not trigger · IWSDK `Interactable` is
deprecated · `Object3D.getWorldDirection()` returns +Z not -Z · any `THREE.Sprite` in the XR scene
graph crashes IWSDK's pointer system · `Entity.dispose()`/`createTransformEntity` GPU-resource and
scene-graph facts · IWSDK resets `visual.model.visible` every frame · a discarded Web Audio object
keeps playing unless explicitly stopped.

**`xr-3d-rendering.md`**: local-Z refactor required before XR is visible · charts without `song.ogg`
freeze the highway · `FretPlayerScene3D.getFretPosition()` is non-linear · `QuadBatch` re-uploads its
full buffer capacity every frame (known, not yet fixed).

**`dev-environment.md`**: Windows `/@fs/` cross-drive paths fail · IWSDK device mode's IWER "Enter
XR" button is absent · debugging JS console from Quest Browser on PC · console errors need
special-casing for `Error` objects (reclassified from `UikitLessonsLearned.md` — this was never
actually uikit-specific, it's a general debug-tooling fact that happened to surface while debugging
uikit).

### `lessons/engineering-hygiene.md` (5 entries — process sub-category A)

- Async work gated by a live state flag needs the callback to re-check too, not just the call site
  — **genericize**, see below.
- A codebase can have more than one loading path for "the" data model — find every producer/consumer.
- Audit what a reused "load everything" function actually needs before reusing it wholesale.
- Before deleting shared global state, grep every reader/writer, not just the files being touched
  (reclassified from `UikitLessonsLearned.md`'s `world.globals.*` entry — the lesson is general,
  the uikit-migration example was just where it first showed up).
- A "resolve and cache a resource" helper shouldn't also have a side effect only some callers want
  (reclassified from `UikitLessonsLearned.md`'s `_withDoc()` entry, same reasoning).

### Moved to persistent memory, pruned from repo (process sub-category B)

- `"Confirmed absent" needs a verified search surface, not just a clean grep`
- `Don't trust remembered file state across turns — re-read before extending prior work`

### Omit entirely (not genericized — nothing durable left once the tie to removed code is cut)

- `+` in element IDs crashes `querySelector` — tied to the removed html2canvas DOM-routing pipeline;
  uikit's `getElementById()` isn't a real CSS-selector lookup, the specific risk doesn't reapply.
- XR settings panels are html2canvas-rendered images, not live DOM — describes fully-replaced
  architecture; a "how it used to work" note has no forward value.
- Per-frame update hooks silently dead when a screen migrates off html2canvas — that migration is
  complete project-wide; its general shape is already covered more durably by the
  engineering-hygiene entries above.

## Worked genericization example (html2canvas)

Before (tied to removed pipeline, no explicit note that it's historical):

> **Symptom:** An idle-timeout blank overlay for the XR panel (drawn after 3s unhovered) appeared to
> have no visible effect — it drew correctly, then was immediately undone.
> **Root cause:** An `html2canvas` capture already in flight when the panel crossed into "idle"
> still resolved normally, and its `.then()` callback unconditionally overwrote the canvas with the
> (stale, pre-idle) captured content...

After (principle kept, generic framing, explicit historical note):

> **Async work gated by a live state flag needs the callback to re-check too, not just the call
> site**
>
> An async operation started while a condition was true can resolve after that condition changes —
> if the callback doesn't re-check the live state itself, it applies a stale result anyway. First
> found in the now-removed `html2canvas` panel-capture pipeline: an idle-timeout overlay was
> silently undone because a capture already in flight resolved after the panel went idle, and its
> callback unconditionally applied the stale captured content.
>
> **Fix:** re-check the live condition inside the callback itself, not just before starting the
> async call.

## `lessons/README.md` — the decision checklist for future captures

Content to author verbatim into that file:

1. Is this about *my own* verification/reliability habits, not code or design? → persistent memory,
   not the repo.
2. Is this a general software-design principle, demonstrated by a real bug here? →
   `engineering-hygiene.md`.
3. Otherwise, uikit/uikitml/PanelUI? → `ui-toolkit/<topic>.md`, topic chosen by activity (syntax,
   text, panel-lifecycle, scrolling, pointer, assets/tooling).
4. Otherwise → `engine/<topic>.md` (runtime-apis / xr-3d-rendering / dev-environment).
5. Cross-cutting: file under whichever system constrains the fix, cross-list under every relevant
   heading in that directory's `INDEX.md` — content lives once, discovery can point from multiple
   angles.

## Skills

Three, one per directory (`engineering-hygiene.md` is small enough to be its own skill target
without a directory):

- **`uikit-lessons`** — *"Known uikit/uikitml/PanelUI gotchas — check before writing or editing
  `.uikitml` files or XR panel/dropdown/screen code."* Reads `ui-toolkit/INDEX.md`, matches keywords
  against the current task, reads only the matching sub-file(s).
- **`xr-engine-lessons`** — *"Known IWSDK/Three.js/XRProto rendering and dev-environment gotchas —
  check before touching XR scene graph, input, rendering internals, or build/dev setup."* Same
  pattern against `engine/INDEX.md`.
- **`engineering-hygiene-lessons`** — *"Design hygiene lessons — check before deleting/modifying
  shared global state, extending a data model consumed in multiple places, or reusing an existing
  broad function for a narrower purpose."* Reads the single file directly, no index needed at this
  size.

Not user-invoked slash commands — per how the Skill tool works, the listing is shown every session
and the expectation is that I check it against whatever I'm about to do and invoke a matching skill
myself, same as any other skill.

## Execution checklist (done)

- [x] Create `lessons/README.md` with the decision checklist above.
- [x] Create `lessons/engineering-hygiene.md` with its 5 entries (1 genericized).
- [x] Create `lessons/ui-toolkit/` with its 6 files + `INDEX.md`; delete `UikitLessonsLearned.md`.
- [x] Create `lessons/engine/` with its 3 files + `INDEX.md`; delete `LessonsLearned.md`.
- [x] Move the 2 process-B entries into persistent-memory `feedback_*` files.
- [x] Drop the 3 omit-entirely entries. Also dropped the no-system-keyboard `text-rendering.md`
      candidate entry — it's a TODO already tracked in project memory
      (`project_xr_uikit_investigation.md`), not a retrospective lesson.
- [x] Update `CLAUDE.md`'s pointer from `LessonsLearned.md` to `lessons/README.md`.
- [x] Author the 3 skills (`uikit-lessons`, `xr-engine-lessons`, `engineering-hygiene-lessons`) in
      `.claude/skills/`.
- [x] Swept `src/xr/**` and `DifficultyDropdownPlan.md` for in-code/in-doc pointers to the old
      filenames (`UikitLessonsLearned.md`/`ThreeCP/Analysis/LessonsLearned.md`) and repointed them
      at the new tree — these weren't in the original disposition list but were found via grep
      during execution.

**Found during execution, out of the original scope of this plan:** `ThreeCP/v2/LessonsLearned.md`
is a *third*, separate lessons file (Combined-project build/merge gotchas) that this plan's own
discovery grep never surfaced, since it lives outside `ThreeCP/Analysis/`. Left untouched — flagged
to the user as a follow-up decision, not folded in here.
