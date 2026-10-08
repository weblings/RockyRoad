# Migrate docs infra to Aurora's system (+ beads, AGENTS.md)

Status: in progress — steps 1–9 done as of 2026-10-08 (StretchGoals beads skipped per owner)
Id: aurora-docs-migration

Owner-context: assessed 2026-10-08 against Aurora's live tree and RockyRoadImport's finished
migration of the same name (its archived plan + `RockyRoadImport/docs/log/2026-09-30-aurora-docs-migration.md`).
Next agent: work the plan top to bottom; each step lists its done-criteria.

## Source material

- Aurora (`/home/andrew/Documents/Aurora/Aurora`):
  - AGENTS.md — filing contract ("Where things go") + beads integration block; `CLAUDE.md` is a pointer stub
  - `docs/README.md` — layout, `Id:`/`[[id]]` convention, after-move checklist
  - `docs/check-links.py` — link checker + `_ids.md` generator; also scans `.claude/skills/`, root files, slice READMEs
  - `docs/check-lessons.sh` — `Tags:`/`Applies-when:` + index-count guard (flat `lessons/*.md` only)
  - `docs/lessons/README.md` — table index with entry counts; `.claude/skills/` SKILL.md files — grep-the-tags routing
- RockyRoadImport (`/home/andrew/Documents/RockyRoad/RockyRoadImport`): the same migration at small scale —
  `docs/README.md`, `docs/log/INDEX.md`, `CLAUDE.md` beads section, `.beads/` layout are the closest templates.

## Current state (this repo)

- Docs: 16 files flat in `Analysis/` (plus this plan). Only 2 carry any status line; none carry `Id:`.
- Lessons: 113 entries across 13 files, nested (`engine/`, `ui-toolkit/` each with a prose INDEX).
  Entry shape already matches Aurora's (`##` principle headline, root-cause paragraph, `**Fix:**`) —
  only `Tags:`/`Applies-when:` are missing. A standalone TabToChartLessons doc awaits its step-5 fold.
- Skills: 5 `.claude/skills/*-lessons` routing skills exist, all citing `Analysis/lessons/...` paths.
- Tasks: `v2/v0.2.6_TODO.txt` (4 open items, 1 done); `v2/CHANGELOG.txt`. No beads, no `log/`, no check scripts.
  `bd` 1.3.0 at `/home/andrew/.local/bin/bd`.
- Agent instructions: `CLAUDE.md` only, hard-coding `Analysis/lessons/` paths.
- Path citations: ~49 refs to `Analysis/` repo-wide, including 12 code comments in `v2/src/xr/*.ts`,
  `v2/ui/song.uikitml`, `v2/desktop.html`. Those comments are **already dead**: they use the pre-rename
  `ThreeCP/Analysis/...` prefix, and two cite plans that no longer exist (DifficultyDropdownPlan,
  DesktopDropdownSyncPlan).
- Cross-repo: Aurora's `check-links.py` grandfathers `RockyRoad/docs/lessons/...` paths, so it already
  expects this repo to have `docs/` — the rename makes those resolve for real.

## Target state

- `docs/` tree mirroring Aurora: `archive/`, `planning/`, `log/` (+`log/INDEX.md`), `lessons/`, root
  `README.md`, generated `_ids.md`; both check scripts runnable and green.
- All docs carry `Status:` + `Id:`; new citations use `[[id]]`; old path citations keep resolving.
- All 113 lesson entries carry `Tags:`/`Applies-when:`; `check-lessons.sh` green, including nested dirs.
- Tasks in beads; TODO file deleted; `.beads/issues.jsonl` tracked in git.
- AGENTS.md holds the project instructions (Aurora shape); `CLAUDE.md` is a pointer stub.

## Decisions

Settled 2026-10-08:
1. **Rename `Analysis/` → `docs/`.** Both scripts and every Aurora convention assume it.
2. **Move instructions to AGENTS.md.** Current `CLAUDE.md` content moves over; `CLAUDE.md` keeps
   only Aurora's 3-line pointer so `CLAUDE.md`-only loaders still land there.
3. **`log/` starts on migration day, no backfill.** `log/INDEX.md` carries a note that earlier work is
   recorded in `planning/`/`archive/` docs, `v2/CHANGELOG.txt`, and git history.
4. **Lesson tagging is in scope** (step 5), not a follow-up.

Open (recommendations inline):
5. **Keep nested lessons dirs or flatten?** Recommended: keep — `engine/`/`ui-toolkit/` already split by
   query vocabulary, which is Aurora's own splitting rule. Costs a small `check-lessons.sh` change (step 4).
6. **Memory: `bd remember` for clone-specific memory.** Settled 2026-10-08. `bd` writes its agents
   block into AGENTS.md as Aurora has; keep its `bd remember` line, reworded to the split below.
   `bd remember` lives in this clone's local Dolt DB, is readable by any agent via `bd prime` /
   `bd memories`, and is excluded from `bd export` by default — so it stays in this clone. Split:
   - AGENTS.md / `docs/` — anything every clone, collaborator, or agent needs; tracked in git.
   - `docs/lessons/` — code/tooling gotchas (all clones).
   - `bd remember` — memory specific to this clone (any agent). Never export with `--include-memories`
     or `--all`; that would push them to other clones via `issues.jsonl`.
   - Claude memory (`~/.claude/projects/<launch-dir>/memory/`) — not used for this repo. It's Claude-only
     and split by launch folder (Aurora's sits under the parent folder, not the repo). Empty for this
     repo and the parent `RockyRoad/` folder as of 2026-10-08, so nothing to migrate.
   - Lessons README rule 1 ("own verification habits → `feedback_*` memory") changes to `bd remember`
     in step 5.
7. **Beads git hooks?** Settled 2026-10-08: yes, as the carrier for Aurora's doc-lint pre-commit
   block (step 12). Hooks go in `.beads/hooks/` (tracked), installed with `bd init` at step 8.
8. **`StretchGoals.md` and the plan's "Known UX issues (deferred)" → beads?** Recommended: yes, one bead
   per `###` idea (priority backlog/P4) and one for the deferred UX issue; then archive `StretchGoals.md`.

## Plan

1. **Triage the 16 docs** (check `git log --follow` for last substantive edit before trusting any claim):
   - `archive/` (shipped C#→TS conversion analyses, all last touched 2026-03-15): `Camera3D`,
     `ChartPlayerGame`, `ChartScene3D`, `MidiMap`, `NoteDetector`, `PlayerScenes`, `Scene3D`,
     `SongPlayer`, `FilesOutOfScope`.
   - `archive/` (done per own text): `WebXR_IWSDK` (`STATUS: ✅ COMPLETE`), `SoundTouchSpeedPlan`
     (`Status: done`), `CombinedProjectPlan` (single Vite build with `desktop.html`/`xr.html` exists),
     `XRProtoUIFlowPlan` (verify its deferred items before archiving; file beads for any still wanted).
   - `planning/`: `ImplementationPlan` — the roadmap, per-phase status is the source of truth (Aurora keeps
     its equivalent there). This plan doc goes here too until closed.
   - `StretchGoals`: per decision 8. `TabToChartLessons`: fold into `lessons/song-content-authoring.md` (step 5).
   Done when: every doc has a destination written next to it in this list.
   Verified 2026-10-08 (`git log --follow`): 9 shipped C#→TS docs last touched
   2026-03-15 in one commit; `WebXR_IWSDK`/`SoundTouchSpeedPlan` carry their done
   markers; `desktop.html`+`xr.html` exist; XR plan's deferred items are done except
   server-side discovery (still needs backend) and XR tuner (still out of scope).
2. **Restructure.** `git mv Analysis docs`; create `archive/`, `planning/`, `log/`; `git mv` each doc per step 1.
   Done when: `git status` shows renames (not delete+add).
3. **Tag docs + write the map.** `Status:` + `Id:` on every doc (archived ones say what shipped, with date).
   `docs/README.md` adapted from RockyRoadImport's; `log/INDEX.md` with headers + the decision-3 note.
   Done when: `grep -L '^Id:' docs/**/*.md` lists only lessons files, READMEs, INDEX files.
4. **Port the scripts.** Copy Aurora's `check-links.py` (not RockyRoadImport's older `.sh` copy) and
   `check-lessons.sh`. Empty `GRANDFATHERED`; point the extra-citer scan at this repo's
   outside-`docs/` files (`README.md`, AGENTS.md, `CLAUDE.md`, `v2/ARCHITECTURE.md`, `v2/Setup.md`).
   Make `check-lessons.sh` recurse into subdirs and check counts against the index that lists each file
   (`lessons/README.md` or `<subdir>/INDEX.md`). Run `check-links.py` twice (first run generates `_ids.md`).
   Done when: both green.
5. **Tag lessons.** Add `Tags:` + `Applies-when:` directly under every `##` headline (113 entries + the
   TabToChart entries folded in). Convert `lessons/README.md` and both subdir INDEX files to Aurora's table
   shape (`File | Scope | Entries | File here when`), keeping the existing prose summaries in Scope.
   Fix `lessons/README.md`'s stale "`ThreeCP/Analysis/`" wording, and point its rule 1 at `bd remember`
   (decision 6). Delete the TabToChartLessons doc after folding.
   Done when: `bash docs/check-lessons.sh` → `lessons OK`.
   Done 2026-10-08: 118 entries tagged (113 + 5 folded). TabToChart's String-table and tab-photo
   entries merged into existing ones; its "HandFret defaults to 0" (contradicted by the cross-check
   entry) and conversion-pipeline wishlist (superseded by the GP5 path) dropped.
6. **Update the skills.** All 5 SKILL.md files: paths → `docs/lessons/`, and add Aurora's "grep
   `Tags:`/`Applies-when:` for the task, read only matching entries" usage step. Update the skill
   descriptions only if paths appear in them.
   Done when: `check-links.py` (which scans skills) stays green.
7. **Fix code-comment citations.** The 12 dead `ThreeCP/Analysis/...` comments: lessons → cite by
   headline (per Aurora's rule, headlines survive splits), plan docs → `[[id]]`; the 2 citing missing
   plans → drop the citation, keep the reasoning. Comment-only edits.
   Done when: `grep -rn 'ThreeCP/Analysis\|Analysis/' v2/src v2/ui v2/*.html` is empty.
8. **Migrate tasks to beads.** `bd init --non-interactive` (prefix `RockyRoad`; hooks per decision 7 —
   if init doesn't put them in `.beads/hooks/`, run `bd hooks install --beads`); one bead per
   open TODO item (tuner screen return, score display on Play page, keyboard MIDI for keys score, XR custom
   keyboard); beads per decision 8. `bd export -o .beads/issues.jsonl`; delete `v2/v0.2.6_TODO.txt`
   (its one done item, piano long held notes, isn't in `CHANGELOG.txt` as of 2026-10-08 — add it
   there first). Keep `CHANGELOG.txt`.
   Done when: `bd ready` shows them; export current.
9. **Write AGENTS.md, stub `CLAUDE.md`.** Move current `CLAUDE.md` rules (comment style, lessons
   location, lessons-capture part 2) into AGENTS.md, plus Aurora's "Where things go" adapted: beads loop
   (export before `git add`, `bd import` after pull), lessons + skills routing, log on close, `[[id]]`
   citing, archive-on-close requirement, slice-README rule for `v2/`/`v0/`. Keep the beads block from
   step 8, reworded per decision 6, and add the decision-6 memory split (incl. "never export memories").
   Add Aurora's `SessionStart` hook (`bd prime --hook-json`) to a tracked `.claude/settings.json` if
   `bd init` didn't, so Claude sessions load the clone's memories. Replace `CLAUDE.md` with Aurora's pointer stub.
   Done when: no rule from the old `CLAUDE.md` is lost (diff them side by side).
10. **Sweep other docs + memory.** Root `README.md`, `v2/ARCHITECTURE.md`, `v2/Setup.md`: fix `Analysis/`
    and `ThreeCP` path refs. Check the Claude memory dir for `Analysis/` paths. Check RockyRoadImport and
    Aurora for citers of this repo's old paths (Aurora's grandfathered `RockyRoad/docs/...` entries can
    then be dropped — separate repo, separate change).
    Done when: `grep -rn 'Analysis/' --exclude-dir=node_modules --exclude-dir=.git .` hits only `docs/archive/`
    and `docs/log/` (historical text).
11. **Wire the checkers into pre-commit.** Last, so the hook doesn't block the migration's own
    in-progress commits. Copy Aurora's `PROJECT DOC-LINT HOOKS` block from its `.beads/hooks/pre-commit`
    (below the beads markers): runs both scripts only when staged paths touch `docs/`, `.claude/skills/`,
    a `README.md`/`CLAUDE.md`, or AGENTS.md, and re-stages `docs/_ids.md`. Add `v2/ARCHITECTURE.md` and
    `v2/Setup.md` to its path filter.
    - **Activate per clone:** Aurora's Linux checkout has the hooks tracked but inactive (`core.hooksPath`
      unset, `.git/hooks/` only samples, 2026-10-08), so they never run there. Set
      `git config core.hooksPath .beads/hooks`, document it in AGENTS.md, and file the same fix as an Aurora bead.
    - **`prepare-commit-msg`** adds agent identity trailers. Check what it writes; remove it if it adds
      attribution lines (no Claude attribution in commit messages).
    Done when: `git rev-parse --git-path hooks` → `.beads/hooks`; a commit with a deliberately broken
    `[[id]]` in `docs/` is rejected and a code-only commit isn't slowed.
12. **Close out.** Write docs/log/2026-10-XX-aurora-docs-migration.md + INDEX row; set this doc's
    `Status:` to done and move it to `docs/archive/`; rerun both scripts.

## Verification (all must hold before calling it done)

- `python3 docs/check-links.py` → OK; `bash docs/check-lessons.sh` → `lessons OK`.
- `bd ready` shows the migrated items; `.beads/issues.jsonl` exported and current.
- A test `bd remember` shows up in `bd prime` output and is absent from `.beads/issues.jsonl` after export
  (then `bd forget` it).
- No live (non-archive, non-log) file references `Analysis/` or the deleted TODO filename.
- `git status` shows renames detected for every moved doc.
- Pre-commit doc-lint hook is active in this clone and rejects a broken `docs/` citation (step 11).
- The v2 build still passes (`npm run build` in `v2/`) — the comment edits in step 7 must not break anything.

## Out of scope

- `log/` backfill (decision 3); CI wiring for the check scripts (pre-commit is step 11).
- Editing Aurora's or RockyRoadImport's grandfather lists (noted in step 10, done in those repos).
- Rewriting archived docs' content beyond the `Status:` line.
