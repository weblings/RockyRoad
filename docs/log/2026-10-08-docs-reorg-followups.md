# Docs reorg follow-ups

Id: 2026-10-08-docs-reorg-followups
Status: shipped 2026-10-08 — RockyRoad-k9h closed.

Gap pass vs Aurora after [[2026-10-08-aurora-docs-migration]].

## What landed

- `CONTRIBUTING.md` (new): beads workflow, hook activation, docs conventions, gates. README
  "For developers" is now three links (architecture, CONTRIBUTING, `docs/README.md`).
- `CONTRIBUTING.md` added to `check-links.py` citer list and the pre-commit trigger paths.
- Filename citations → `[[id]]`: [[stretch-goals]], [[files-out-of-scope]] (table),
  `SongPlayer.ts`, `QuadBatch.ts`. `v0/src/QuadBatch.ts` left as-is (legacy build).
- 13 lesson files got `Id: lesson-*` (`lesson-engine-*`, `lesson-uikit-*` in subfolders).
- Duplicate `bd setup codex` block dropped from AGENTS.md.

## Verification (observed 2026-10-08)

- `check-links.py` → `links OK`; `check-lessons.sh` → `lessons OK`.
- First checker run on CONTRIBUTING.md flagged a bare `INDEX.md` mention; fixed to full path.
- No `v2/` build run: code changes are comments only.

## Notes

- `check-links.py` does not scan `v2/src`, so `[[id]]` in code comments is unchecked.
- Re-running `bd setup codex` will likely re-add the removed block.
- No lesson filed: nothing here cost real diagnosis time.
