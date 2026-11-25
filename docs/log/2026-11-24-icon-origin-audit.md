# Icon origin audit: Vidstack and OpenMoji

Id: 2026-11-24-icon-origin-audit
Status: work done 2026-11-24 on `feat/MIDI_IO`, bead still open because it depends on RockyRoad-9f2. Every icon in `public/` has a recorded origin. The folder icon is the one icon whose licence is unconfirmed, tracked in RockyRoad-hdv. Not yet merged to `dev` or `main`.

Covers RockyRoad-cou. Follows [[2026-11-24-setup-wrench-icon]], which created `THIRD_PARTY_NOTICES.md`.

## Method

- Path data in each `public/*.svg` was compared exactly (whitespace stripped) with Vidstack `media-icons` raw SVGs and with Grille's icons.
- The Vidstack copy used was 0.10.0 from Grille's `node_modules`, then the GitHub repo for icons the package lacks.
- OpenMoji and non-matching files were settled by the owner, who knew which emoji each was altered from.
- Zest Free was checked by downloading its `check.svg` from GitHub.

## Results

- Vidstack, exact path match: `back-arrow` (arrow-left), `chevron-down`, `chevron-up`, `pause-icon`, `play-icon`, `play-icon-white`, `recal-icon` (repeat-on), `replay`, `tuner-restart` (replay), `settings-gear-icon`, `tune-icon` and `tune-icon-dark` (odometer).
- Vidstack check: `check.svg`, `tuner-check.svg` and `CHECK_PATH` in `src/desktop/TunerScreen.ts` match `raw/check.svg` in the GitHub repo (commit 9c1fafb, 2024-03-28). The npm 0.10.0 package does not include it, which is why the first pass found no match.
- OpenMoji, owner-altered: `Guitar_White` and `Bass_White` (1F3B8), `Keys_White` (1F3B9), `setup-icon` (1F527). `RockyRoad_Temp.svg`, the favicon, merges 1FA78, 1F3B5 and 1F36A.
- `AddFolder.svg` was altered from svgrepo.com/svg/8039/folder-outline. SVG Repo blocked automated fetches (security checkpoint, then 429), so its licence was not read. RockyRoad-hdv rebuilds it from Zest Free's folder instead.
- `public/favicon.svg` and `public/icons.svg` were Vite starter files with no references. Deleted at the owner's request.

## Findings

- Zest Free's check is a different 24-grid drawing from ours, so it was never the source. No Zest icon is in use yet.
- The tuner logs (2026-10-13) record the check only as a committed file, with no origin. The audit supplied it.
- Aurora has no check icon in `web/ui/icons` and its notices list none. It uses the text glyph for status cues and Grille's own check inside menus. Grille's check is drawn for Grille, not from Vidstack or Zest.

## What landed

- Origin comments on every matched or derived icon and on the `CHECK_PATH` line.
- `THIRD_PARTY_NOTICES.md`: Vidstack section with the MIT text and OpenMoji section listing five sources. No Zest section until RockyRoad-hdv lands.

## Open

- RockyRoad-hdv: replace the folder icon and add the Zest Free entry.
- The app was not rebuilt after the comment edits. SVG comments are assumed safe for the `<img>` and uikitml loaders, since `RockyRoad_Temp.svg` already carried one.
- Nothing is committed.
