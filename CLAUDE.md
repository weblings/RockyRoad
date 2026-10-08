# Project instructions

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
similarly named doc) elsewhere in the repo, even inside a subproject like `v2/` — a prior
session did exactly that (v2/LessonsLearned), and its entries had to be found later
via a repo-wide grep and folded back in. If you're ever unsure whether a lessons doc already
exists somewhere, `find . -iname "*lesson*"` before creating one.

**Part 2 of any lessons-capture pass: check docs, not just gotchas.** After filing whatever
gotcha prompted the capture, also check whether that same session's code change made any
README/doc (root, `v2/ARCHITECTURE.md`, `RockyRoadImport/README.md`) claim stale — a moved/removed
feature, a changed tech-stack detail, a broken link — and fix it in the same pass rather than
leaving it for a later cleanup. This is how `v2/ARCHITECTURE.md` (then still named `README.md`)
accumulated a dead `html2canvas` claim and a broken Setup.md link in the first place.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
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
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

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
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
