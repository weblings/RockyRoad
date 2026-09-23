# Tuner screen — v0 vs v2 visual alignment

**Sources:**
- `v0/src/TunerScreen.ts` + `v0/index.html` (`.tuner-*` rules)
- `v2/src/desktop/TunerScreen.ts` + `v2/desktop.html` (`.tuner-*` rules)
- `v2/src/shared/FretPlayerScene3D.ts` (per-string color reference)

## Summary

v2's `TunerScreen` was already mostly migrated from v0's blue-accent/dark-bordered
look to v2's flat neutral design system (`#333333` buttons, `#dadada`/`#111111`
primary action, `#8b8b8b`/`#c8c8c8` text hierarchy, Inter font, 5–6px radii). A
handful of pieces were missed.

## Findings

### 1. `.tuner-exit-btn` still uses v0's blue accent
The "Done" button on the "In tune!" complete overlay uses `#2a6eff` / hover
`#1a5ee0`. Every other primary action on the screen (`.tuner-btn-exit`,
`.pre-play-btn`, `.lib-btn-primary`, `#settings-close`) was migrated to
`#dadada` bg / `#111111` text / `#bebebe` hover. This is an inconsistency
inside v2 itself, not just vs. v0 — highest-confidence fix.

### 2. `.tuner-canvas-wrap` off the surface scale
`background: #111; border: 1px solid #222;` — doesn't sit on v2's surface
scale (`#0a0a0a` screen / `#1a1a1a` panel / `#242424` card / `#333333` control).

### 3. `.tuner-select` kept v0's bordered-dark input style
`#1a1a1a` bg + `1px solid #333`, no hover state — instead of v2's flat
no-border input pattern (`#333333` → hover `#515151`) used by `.lib-search`
and `.dropdown-trigger`. Lower confidence: `.lib-tuning` still uses the same
bordered style, so this may be an accepted secondary variant rather than an
oversight.

### 4. `.tuner-mic-wait` text color
`#888` doesn't match the `#8b8b8b`/`#c8c8c8` text tokens used elsewhere.

### 5. Canvas-drawn (2D context) colors never migrated
`drawCanvas()` still hardcodes v0's raw grays — `#666` (inactive note
labels), `#888` (phase label), `#ccc` (cents readout), `#555` (MIC label),
`#444` (Hz debug), `#222` (signal bar track) — none matching the CSS-side
tokens (`#8b8b8b`, `#c8c8c8`, `#333333`, `#1a1a1a`) the rest of the screen
now uses. Canvas `fillStyle` can't inherit CSS variables, so these need
matching hex constants updated by hand.

### 6. `STRING_COLORS` doesn't match `FretPlayerScene3D` (pre-existing, not a v2 regression)
`TunerScreen.ts`'s `STRING_COLORS` (`Red/Orange/Yellow/Green/Blue/Pink`) is
commented "mirrors FretPlayerScene3D string palette" but doesn't actually
match `FretPlayerScene3D.ts`'s `STRING_COLORS` (`Red/Yellow/Cyan/Orange/Green/Purple`,
offset by 1). Same bug exists in v0's `FretPlayerScene3D.ts`, so it's not a
v2-introduced issue — but it means the tuner's per-string color doesn't match
the color that string renders as on the actual fretboard.

## Task: re-enable the Tuning button

**Desktop** gates it behind one flag: `TUNER_ENABLED` in
`v2/src/desktop/App.ts:15`, currently `export const TUNER_ENABLED = false;`
with the comment "Tuner + Play note-hit feedback, off for now (planned to
return later)". It's read in three places:
- `App.ts:60` — `shouldAutoTune()`, whether the tuner auto-fires before a
  stringed part starts playing
- `PreSceneScreen.ts:70,100` — shows/hides the `.pre-tune-btn` "Tune" button
  on the pre-song screen (also gated on `part.tuningOffsets` existing)
- `ActiveSceneScreen.ts:239` — `setupNoteDetection()`, gates the mid-song
  pitch-detection/note-hit feedback for stringed instruments

Flipping `TUNER_ENABLED` to `true` should be enough to bring the button and
its auto-tune/note-detection behavior back on desktop, once the styling
fixes above are applied.

**XR** has no equivalent flag and no Tune button in the UI at all —
`v2/ui/*.uikitml` and `v2/src/xr/*` have no tuner button, tuner screen, or
gating logic to flip. Re-enabling on XR means building the feature there,
not toggling a switch.
