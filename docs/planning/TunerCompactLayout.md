# Tuner compact layout

Id: tuner-compact-layout
Status: keep, decided 2026-10-15. Built on desktop (4bi.8, 4bi.9) and confirmed on desktop and
mobile across screen sizes and rotations. The dev toggle is gone and the layout is the default.
Next is the XR tuner (RockyRoad-0q4).

Builds on the desktop tuner from [[2026-10-13-tuner-return-desktop]] and [[tuner-v2]]. Today the
canvas is a fixed 960x540 and the controls row is one non-wrapping line (about 560px), so the
page has no small-screen behavior.

## Layouts

- **Large:** the current vertical six-string canvas, used while it fits.
- **Medium:** two same-sized boxes side by side.
- **Narrow:** the boxes stacked, Box 2 shrinking to its content.
- No separate short-landscape layout. Phone landscape uses Medium.

```
 MEDIUM                                         NARROW
+-------------------------------------------+  +---------------------------+
| [< Back]                      [Settings]  |  | [< Back]       [Settings] |
|   Input [Mic v] # |  Gain ===o-- 4x       |  |  Input [Mic          v] # |
|  +-------------------+ +----------------+ |  |  Gain  ======o----  4x    |
|  | +--+              | |                | |  |  +---------------------+  |
|  | |G3| ---:---|---  | | E2 A2 D3 G3 .. | |  |  | +--+                |  |
|  | +--+    :  +12    | | v  v  v  .  .. | |  |  | |G3| ---:----|---  |  |
|  +-------------------+ +----------------+ |  |  | +--+     :   +12   |  |
|         [ Restart ]  [   Done   ]         |  |  +---------------------+  |
+-------------------------------------------+  |  +---------------------+  |
                                               |  | E2 A2 D3 G3 B3 E4   |  |
                                               |  | v  v  v  .  .  .    |  |
                                               |  +---------------------+  |
                                               |  [ Restart ]  [ Done ]   |
                                               +---------------------------+
```

## Controls

- **Setup row on top:** Input select, mic meter and Gain, in every layout and on XR. Gain wraps
  under Input when narrow.
- **Actions row at the bottom:** Restart (dark) and Done (light), in every layout and on XR,
  matching XR Song's Reposition/Play bar.
- **Large layout:** keeps the setup row above the canvas. Restart and Done move below it.
- **Nav bar:** Back and Settings are unchanged.

## Box 1: current string

- **Border:** in the string's color. A white wipe fills it, driven by dwell progress, the same input
  as today's `strokeLockBorder`. The wipe starts at the bar's x on the top and bottom edges, spreads
  both ways and closes on the sides.
- **Label:** the string name, the same text as Box 2 (e.g. `G3`), in the string's color. It's sized
  to fit the box's height, with no minimum.
- **Track:** a thin, dark, abstract line with a faint center tick. Flat is to the left and sharp to
  the right. The colored string is not used as the track because its direction doesn't match how the
  string is tuned.
- **Bar:** the existing white 4px needle with the same filtering (median, easing, clarity gate). It
  doesn't settle or thicken on lock, so the border carries all the lock feedback.
- **Cents label:** sits under the bar and tracks its x, clamped to the track. It shows a signed value
  up to ±99, then `Flat` (left-justified) or `Sharp` (right-justified).

## Box 2: string progress

- **Labels:** every string's name in its own color. The current string is bold and the rest are
  dimmed.
- **Checks:** today's rules. White when tuned, dim gray carried into validation, white again when
  re-verified.
- **Order:** always low string on the left, matching the low-to-high tuning order. Independent of
  `invertStrings` (settled 2026-10-14).

## Overlays

- **"In tune!" and "Waiting for mic":** each covers both boxes as one unit, so a single wrapper
  replaces `.tuner-canvas-wrap`.

## XR (later)

- **Panel:** fixed 40x30cm, using the Narrow (stacked) arrangement.
- **Setup row:** fits on one line (about 33cm). Dropdowns keep opening downward, so no upward
  variant is needed.
- **Gain slider:** uikit has no native range input, so it needs a custom build.
- **Border wipe:** uikit has no clip-rect, so the wipe needs edge strips.
- **Mic (spike 0q4.1, 2026-10-15):** go. In the Quest Browser, `getUserMedia` is granted from a
  button on the page before entering AR, and pitch detection keeps working inside the immersive
  session. `enumerateDevices` lists three inputs: Default, Speakerphone and Headset earpiece.
- **Input dropdown:** kept, with Default preselected. The extra two look like Android audio routes,
  not distinct mics, and whether they differ in signal is untested.
- **Entry:** `song-flow` only, matching desktop. Tune button on the Song actions bar and auto-tune
  before Play.
- **Song buttons (decided 2026-10-15, guitar/bass only):** the secondary button is Tune on tuned
  parts and hidden otherwise, replacing Reposition there. Reposition stays in the Play HUD. Play
  calibrates on first use, then auto-tunes only when the part's tuning differs from the last tuned
  one, as on desktop. Keys keep Reposition in that slot later. A Setup hub is revisited then.
- **In-session grant (tested 2026-10-15):** with site and browser permission already granted, the
  mic starts automatically on entering XR. Without it, the request fires but the prompt is not
  visible until the user leaves immersive mode. No web way to show a system toast inside a session
  was found. The first grant needs a pre-session step on the page (see RockyRoad-0q4.5).
- **Mic permission design (decided 2026-10-15):** main path is a page step on `xr.html` before Enter
  XR, shown on VR-capable devices when permission is `prompt`. Safety net is a tuner fail state
  telling the user to exit immersive, accept the prompt and return, with a timeout and a denied
  variant. Open: whether a pending request resolves after leaving immersive mode.

## Rejected

- **Header/body/actions rows for the Song page:** proposed as a shared fix for nav overlap.
- **Short-landscape layout:** a merged nav and controls row.
- **All controls at the bottom with an upward XR dropdown:** the setup/actions split replaced it.
- **Needle settling and thickening on lock:** not used in the box layouts.
- **The current string's colored line as Box 1's track:** replaced by the abstract track.

## Breakpoints (settled 2026-10-14, built in 4bi.9)

- **Large to Medium:** switches immediately when the body's inner size drops under 960x760. No canvas
  scale floor, so the canvas never needs a scaling path.
- **Medium to Narrow:** under 560px inner width, where Box 1's track would fall under about 160px.
- **Mechanism:** a `ResizeObserver` on the tuner body sets `data-layout` on `.tuner-main`. Both
  renderers stay mounted and CSS shows one. Overlays sit on the shared `.tuner-canvas-wrap`.

## Open

- **Nav overlap:** the absolute Back/Settings bar can overlap content on short landscape screens.
- **Wipe origin:** fixed where the hold began, or following the bar during the hold.
