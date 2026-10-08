# XRProto UI Flow Plan

Decisions and architecture for extending XRProto beyond the single hardcoded song into a
proper instrument-aware XR app flow. Written after the calibration system was confirmed
working (see `project_xr_piano_alignment.md` for calibration details).

---

## App Flow

```
[XR session starts]
        │
        ▼
  XR Song Library        ← song list from baked manifest.json
        │ user picks song
        ▼
  XR Pre-Scene           ← title, artist, part selector
        │
        ├─ Keys ──────▶  Piano Calibration  ──▶  Keys Active Scene
        │                (skip if saved cal               │
        │                 is already loaded)              │
        │                                                 │
        └─ Guitar/Bass ─  (future — skip for XRProto v1)  │
                                                          │
                          ◀── Back to Library ────────────┘
```

**No tuner screen in XR.** Mic-based pitch detection is not needed for the AR piano
use case. Guitar/Bass flow is deferred entirely — XRProto v1 is Keys-only.

---

## Song Discovery

**Decision: baked `manifest.json`.**

Songs live in `XRProto/public/songs/<folder-name>/`. At build time a script scans
that directory and writes `public/songs/manifest.json`:

```json
[
  { "folder": "fur-elise",      "title": "Für Elise",      "artist": "Beethoven" },
  { "folder": "claire-de-lune", "title": "Clair de Lune",  "artist": "Debussy"   }
]
```

XRProto fetches this once at startup. Adding a song means dropping the folder and
re-running the bake script (wired into `npm run dev` / `npm run build`).

**Why not a hardcoded array?** Adding a song would require editing source. Baked
manifest keeps source and content separate.

**Why not a server API?** The browser has no way to list a remote directory without a
server-side component reading the filesystem. For a future hosted version with dynamic
song discovery (drop a folder → it appears automatically with no rebuild), a backend
endpoint (`GET /api/songs`) would be needed. The frontend fetch call is identical either
way — just the URL and what generates the response changes. Deferred.

---

## CalibrationSystem Changes

### 1. Remove auto-start

Currently `init()` subscribes to `VisibilityState.Visible` and immediately begins
`prompt_left`. Calibration is piano-specific — it must not start until the user has
selected a Keys instrument part.

Replace the auto-start subscription with an on-demand hook:

```ts
this.world.globals.startCalibration = (onComplete: () => void) => {
    this._onComplete = onComplete;
    this.state = 'prompt_left';
    this.updatePanel();
};
```

`XRPreScene` calls this hook after the user taps Play on a Keys part. `onComplete`
fires after the user finishes fine-tuning (the "Done" button in the fine-tune panel).

### 2. Calibration persistence

Calibration should persist between songs and across sessions. The anchor transform
(position, quaternion, scale, fine-tune offsets) is saved to `localStorage` after
fine-tune and reloaded on the next Keys launch.

```ts
// Save (called when user presses "Done" in fine-tune panel)
localStorage.setItem('xr-calibration', JSON.stringify({
    position:   [anchor.position.x, anchor.position.y, anchor.position.z],
    quaternion: [anchor.quaternion.x, ...],
    scale:      anchor.scale.x,
    ftPX, ftPY, ftPZ, ftRY, ftS,
}));

// Load (called by XRPreScene before startCalibration)
const saved = localStorage.getItem('xr-calibration');
```

Pre-scene flow when saved calibration exists:

```
Keys selected → saved calibration found?
  ├── Yes → auto-apply, show uiPanel: "Piano aligned (saved). Recalibrate?" + Play
  └── No  → run full 3-step calibration → fine-tune → Done → Active Scene
```

The "Recalibrate" button is also available in the active scene HUD for mid-session
re-alignment without returning to the pre-scene.

### 3. Hand-tracking support

`CalibrationPointer` interface is already defined in `CalibrationSystem.ts` but not
yet wired up. Two concrete implementations:

**`ControllerCalibrationPointer`**
- Current inline logic extracted into this class
- `getWorldPosition`: reads `player.gripSpaces.left` / `.right`
- `isConfirmDown`: reads `input.gamepads.left/right?.getButtonDown(Trigger)`

**`HandCalibrationPointer`**
- `getWorldPosition`: reads the `index-finger-tip` joint via raw WebXR frame
  ```ts
  const frame    = (world.renderer as THREE.WebGLRenderer).xr.getFrame();
  const refSpace = (world.renderer as THREE.WebGLRenderer).xr.getReferenceSpace();
  for (const source of session.inputSources) {
      if (!source.hand || source.handedness !== side) continue;
      const pose = frame.getJointPose(source.hand.get('index-finger-tip')!, refSpace);
      target.set(pose.transform.position.x, ...);
  }
  ```
- `isConfirmDown`: pinch detection — `thumb-tip` ↔ `index-finger-tip` distance < 20mm,
  fires on the leading edge (was not pinching last frame, now is)

**Mode detection (per-frame in `update()`):**
- `gamepads.left` or `gamepads.right` non-null → controller mode
- Both null → hand mode
- Switches automatically if user removes/puts on controllers mid-session

**Panel message variants:**

| Step | Controller | Hand |
|---|---|---|
| Step 1 (A0) | "LEFT controller on A0, pull left trigger" | "LEFT index finger on A0, pinch to confirm" |
| Step 2 (C8) | "RIGHT controller on C8, pull right trigger" | "RIGHT index finger on C8, pinch to confirm" |
| Step 3 (look) | "Look forward, pull the trigger" | "Look forward, pinch to confirm" |

Step 3 head position reading (`this.player.head`) is unchanged — it is not
controller- or hand-specific.

**Known unknowns:**
- Verify `world.renderer` exposes `xr.getFrame()` within IWSDK system context
- Verify `XRFrame.getJointPose` is available in Quest Browser (it is per spec, but
  confirm in practice)

---

## Screen Breakdown

### XR Song Library (`XRSongLibrary.ts`)

- Fetches `/songs/manifest.json` at startup
- Renders a paged list in `uiPanel` (5–6 songs per page, prev/next buttons)
- No scrolling — prev/next avoids the XR scroll problem
- Song tap → transition to XR Pre-Scene with that entry

### XR Pre-Scene (`XRPreScene.ts`)

- Shows: song title, artist, instrument part selector (Keys / Guitar — but Guitar
  disabled with a "coming soon" note for v1)
- No album art, no Tune button
- Play button:
  - Keys selected + no saved calibration → `startCalibration(onComplete)`
  - Keys selected + saved calibration → auto-apply + show active scene
  - Guitar selected → disabled (v1)
- "← Back" button → song library

### XR Active Scene (`XRActiveScene.ts`)

- Wires `world.globals.highwayScene` and `world.globals.songPlayer` (same as now)
- `uiPanel` shows:
  - Song title (small, top)
  - ▶/⏸ Play/Pause
  - Recalibrate (Keys only — calls `startCalibration` again, which re-saves on Done)
  - ← Back to Library
- `HighwaySystem` continues driving the Three.js render loop (unchanged)

---

## `index.ts` Changes

Boot sequence changes from:

```
fetch song → create anchor → attach highway → register systems
```

to:

```
create anchor (empty) → fetch manifest → register systems → show library in uiPanel
```

The anchor exists immediately so `CalibrationSystem` can position it. `HighwaySystem`
already guards `if (!scene) return` — safe to register before a song is loaded.

Highway scene creation is deferred to a `loadSong(folder)` function called by
`XRPreScene` after part selection:

```ts
async function loadSong(folder: string, part: SongIndexPart): Promise<void> {
    // fetch song.json, arrangement.json, notes, audio in parallel
    // create KeysPlayerScene3D or FretPlayerScene3D
    // attach mesh to anchorEntity
    // set world.globals.highwayScene
}
```

---

## Files Summary

| File | Status | Change |
|---|---|---|
| `src/index.ts` | Modify | Remove hardcoded song load; anchor-first boot; defer highway creation; load manifest |
| `src/CalibrationSystem.ts` | Modify | Remove auto-start; add on-demand trigger + onComplete hook; add save/load localStorage; add hand-tracking pointer classes |
| `src/XRSongLibrary.ts` | New | Manifest fetch; paged song list; uiPanel renderer |
| `src/XRPreScene.ts` | New | Part selector; saved-cal branch; calls startCalibration or loadSong |
| `src/XRActiveScene.ts` | New | Play/pause HUD; recalibrate button; back to library |
| `public/songs/manifest.json` | Generated | Baked at build time by new script |
| `tools/bake-songs.ts` | New | Scans `public/songs/*/song.json`, writes manifest |

Unchanged: `KeysPlayerScene3D`, `FretPlayerScene3D`, `ChartScene3D`, `SongPlayer`,
`SongFormat`, `UIImage`, `HighwaySystem` (the IWSDK system in `index.ts`).

---

## Out of Scope for XRProto v1

- Guitar / Bass / Drums flow
- Tuner screen (not needed for AR piano)
- Settings panel in XR (full keyboard, bold text etc. — use 2D app defaults for now)
- Dynamic server-side song discovery (needs backend; deferred)
- Album art in XR pre-scene
