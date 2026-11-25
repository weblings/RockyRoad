# Setup wrench icon: crop and OpenMoji attribution

Id: 2026-11-24-setup-wrench-icon
Status: file work done 2026-11-24 on `feat/MIDI_IO`, bead RockyRoad-9f2 still open. The icon is not yet shown in a Song page button because the Setup button does not exist. Not yet merged to `dev` or `main`.

Icon for the Setup hub button in [[keyboard-midi-xr-flow]]. Covers RockyRoad-9f2. The audit of existing icons is RockyRoad-cou, which depends on this bead.

## What landed

- `public/setup-icon.svg`: 14x14, viewBox `9 11.5 54 54`, white fill and stroke, origin comment on line 1.
- `THIRD_PARTY_NOTICES.md` at the repo root, new. One entry so far, OpenMoji 1F527 (CC BY-SA 4.0), in Grille's format: source URL, copyright holder, licence link, Changes line, same-licence note.
- No dark variant. No light button uses the icon yet (`tune-icon-dark.svg` is the precedent if one does).

## How the crop was made

- Source is `D:/Users/Andrew/Documents/Inkscape/Wrench.svg`, drawn on an A4 page (210x297 mm viewBox).
- The wrench is one path inside a group scaled by 0.26458333. The path was copied out in its own coordinates, so the group transform and Inkscape metadata are gone.
- Path bounds are about x 22 to 50 and y 13 to 64 with a 2 unit stroke. The square viewBox is centred on x 36 and y 38.5 with a margin.
- The wrench is tall and narrow, so it sits centred with side margins in the square.

## Findings

- Grille keeps its notices in an extensionless `THIRD_PARTY_NOTICES`. Aurora uses a Markdown file. RockyRoad follows Aurora, as the bead asked.
- Grille's Vidstack and Zest entries were not copied. Whether RockyRoad needs them is the RockyRoad-cou audit.
- The wrench is also a candidate for Grille's `src/icons` as a 24-grid IconData. Not done.

## Open

- The rendered crop was not viewed, so the padding is untested.
- Showing the icon in a Song page button waits on the Setup hub wiring beads under RockyRoad-n6k.
- Nothing is committed.
