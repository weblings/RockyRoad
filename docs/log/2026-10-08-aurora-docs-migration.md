# Aurora docs migration

Id: 2026-10-08-aurora-docs-migration
Status: shipped 2026-10-08 — milestone closed, plan archived.

Migrated docs infra to Aurora's system (plan [[aurora-docs-migration]], now in `archive/`).

## What landed

- `Analysis/` → `docs/` with `archive/`, `planning/`, `log/`; every doc carries `Status:` + `Id:`.
- `docs/check-links.py` (Aurora's, empty grandfather list) and `docs/check-lessons.sh`
  (recurses into nested lesson dirs) green.
- 118 lesson entries tagged (`Tags:`/`Applies-when:`); TabToChartLessons folded, 2 entries
  dropped (contradicted/wishlist). 5 skills repathed with tag-grep usage step.
- 12 dead `ThreeCP/Analysis/...` code comments fixed by headline/`[[id]]`; 2 missing-plan
  citations dropped, reasoning kept.
- 4 TODO items → beads (RockyRoad-4bi/-b74/-ws1/-lyi); `v0.2.6_TODO.txt` deleted after
  logging its done item in `CHANGELOG.txt`.
- AGENTS.md holds instructions (+ Aurora's "Where things go", memory split); `CLAUDE.md`
  is a pointer stub; `.claude/settings.json` runs `bd prime --hook-json`.
- Pre-commit doc-lint hook (step 11): checkers run only on docs-touching commits,
  `docs/_ids.md` re-staged; `core.hooksPath=.beads/hooks`, documented in AGENTS.md.
- Step-10 tail folded here: `check-links.py`'s own `Analysis/` comment reworded (last live-tree hit).

## Verification (observed 2026-10-08)

- `check-links.py` → OK; `check-lessons.sh` → `lessons OK`, before and after close-out.
- `bd ready` shows the 4 migrated items; `.beads/issues.jsonl` exported, unchanged by export.
- `bd remember` probe appeared in `bd prime`, absent from export, then `bd forget`n.
- `grep Analysis/` hits only `docs/archive/` + `docs/log/`; root README and `v2/` slice docs clean.
- Hook: staged bad `[[id]]` rejected (exit 1); staged code-only file skipped checkers (~0.1 s, exit 0).
- `npm run build` in `v2/` → 6 compiled, 0 failed.

## Surprises / notes

- `bd init` had already set `core.hooksPath` (absolute); step 11 normalized it to `.beads/hooks`.
- `prepare-commit-msg` is beads-only, no attribution trailers — kept.
- Aurora's clone has hooks tracked but inactive; filed there as Aurora-pa6c (that repo's change).
- Migration steps were plan-tracked, no bead; `ThreeCP/*` refs remain in [[implementation-plan]]
  as source-material names (outside step 10's named-file scope).
- Log starts here per plan decision 3; earlier work lives in `planning/`/`archive/`,
  `v2/CHANGELOG.txt`, and git history.
