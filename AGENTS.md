# RockyRoad — agent instructions

Three.js + WebXR note-highway music app (guitar/piano), distilled from ChartPlayer
into TypeScript. Self-hosted; `v2/` is the current single build (desktop + XR).
The legacy flat build (`v0/`) was removed, see the `v0.2.5` tag.

## Comment style

Don't write paragraph-long comment blocks (Symptom/Root cause/Fix essay style). Condense to
2-3 lines max if the context can survive that without being lost — a comment nobody will read in
full during a normal review isn't helping. This applies to code comments and to entries added to
`docs/lessons/` (see `docs/lessons/README.md` for where a new entry goes).

Don't reference internal planning labels ("Phase 5", "Phase 3 detail") in comments — they go stale
fast and mean nothing to a reader without that session's context. Describe current behavior/reasoning
instead.

## Lessons learned — one location, repo-wide

`docs/lessons/` is the **only** lessons-learned location in this repo — for every
subproject, not just the one it happens to sit next to. Before writing a new gotcha down, check
`docs/lessons/README.md` for where it goes. Never start a new LessonsLearned (or
similarly named doc) elsewhere in the repo. If you're ever unsure whether a lessons doc already
exists somewhere, `find . -iname "*lesson*"` before creating one.

**Part 2 of any lessons-capture pass: check docs, not just gotchas.** After filing whatever
gotcha prompted the capture, also check whether that same session's code change made any
README/doc (root, `v2/ARCHITECTURE.md`, `RockyRoadImport/README.md`) claim stale — a moved/removed
feature, a changed tech-stack detail, a broken link — and fix it in the same pass rather than
leaving it for a later cleanup.

## Where things go

- Tasks (open, blocked, deferred): `bd` (`bd ready`, `bd list`), not markdown
  TODOs or checkboxes. Run `bd export -o .beads/issues.jsonl` immediately before
  `git add`ing task state. After `git pull`, run `bd import` to upsert the tracked
  export into your live DB — never `--reinit-local`. On a fresh clone run
  `bd init --prefix RockyRoad --non-interactive` first (no local DB yet, so `bd import`
  fails); if a failed import left an empty DB, delete `.beads/embeddeddolt/` and retry.
- Doc-lint pre-commit hook: activate per clone with `git config core.hooksPath .beads/hooks`.
  Runs `docs/check-lessons.sh` + `docs/check-links.py` only on commits touching `docs/`,
  skills, READMEs, AGENTS.md/CLAUDE.md/CONTRIBUTING.md, or the `v2/` slice docs (`--no-verify` bypasses).
- Non-obvious gotchas worth saving future time: `docs/lessons/`, with `Tags:`/`Applies-when:`,
  routed by the matching `.claude/skills/` skill — check it before changing
  that area, file per `docs/lessons/README.md`.
- Milestone detail (closed or paused): dated file in `docs/log/` + `docs/log/INDEX.md`
  row on close — every material fact, stated once and tightly; paused work logs
  state + resume pointer. Findings over narration.
- Citing another doc under `docs/`: use `Id:`/`[[id]]`, not a bare
  relative path — see `docs/README.md`'s "Citing other docs" section for
  the full convention. New docs get an `Id:` line under the H1 at creation, not as a
  later cleanup pass. `check-links.py` scans `docs/`, `.claude/skills/`, the root
  agent files, and the `v2/` slice docs, so keep those citers live too.
- **Required at close, not later:** when closing a milestone bead, check its description for a
  referenced `docs/*.md` prerequisite analysis or plan. If that doc's `Status:` line
  doesn't already say shipped/superseded, correct it and move the doc to
  `docs/archive/` in this same close. A doc that fed already-shipped work and still reads as
  "exploratory" or "in progress" later is a bug, not a style choice.
- **Slice docs** (`v2/ARCHITECTURE.md`, `v2/Setup.md`) carry only what doesn't go stale:
  what the slice is, entry points, slice-specific build toggles, keep-in-sync invariants,
  and `[[id]]` pointers. No status or "not yet built" sections — that lives in `Status:`
  lines, beads, and `docs/log/`. When closing a bead that changes what a slice does or how
  it builds, update its doc in the same close.
- Planning docs: decisions, status, pointers only. No task lists, no build play-by-play.
  Every doc carries a `Status:` line — but before trusting "still open"/"exploratory",
  check `git log --follow -- <path>` for the last *substantive* edit (not renames/link
  fixes): if nothing revisited it across real, related shipped work since, it is probably
  stale and belongs in `docs/archive/` with a corrected `Status:` line.
- The overall roadmap: [[implementation-plan]] (per-phase `Status:` lines are the source of
  truth for what's shipped) plus any other still-active planning doc — `docs/planning/`, not root.
- Shipped, superseded, or stale-and-abandoned plans and analyses:
  `docs/archive/` — historical record, not deleted or edited into the present tense.

## Memory: what lives where

- AGENTS.md / `docs/` — anything every clone, collaborator, or agent needs; tracked in git.
- `docs/lessons/` — code/tooling gotchas (all clones).
- `bd remember` — memory specific to this clone (debugging habits, environment quirks),
  readable by any agent via `bd prime` / `bd memories`. Never export with `--include-memories`
  or `--all`; that would push clone-local memory to other clones via `issues.jsonl`.
- Claude memory (`~/.claude/projects/<launch-dir>/memory/`) — not used for this repo.

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:46cd31e7 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for clone-specific persistent knowledge (debugging habits, environment
  quirks) — do NOT use MEMORY.md files, and never export memories (`--include-memories`
  or `--all`) into the shared `.beads/issues.jsonl`; repo knowledge belongs in AGENTS.md
  and `docs/`, which are tracked in git

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
