# Contributing to RockyRoad

Environment setup (Node, HTTPS certs, dev server) lives in [v2/Setup.md](v2/Setup.md); how the
app is put together in [v2/ARCHITECTURE.md](v2/ARCHITECTURE.md). This file covers the workflow
around the code. Coding agents: the full rules are in [AGENTS.md](AGENTS.md).

## Tasks: beads, not TODO lists

All task tracking goes through [`bd` (beads)](https://github.com/gastownhall/beads) — no
markdown TODOs or checkboxes. Issues live in a local DB; `.beads/issues.jsonl` is the tracked
export that carries them between clones over git.

```sh
bd import                   # once after cloning, and after every git pull
bd ready                    # find available work
bd show <id>                # details + dependencies before editing
bd update <id> --claim      # claim work when starting
bd create --title="..." --description="..." --type=task|bug|feature --priority=2
bd close <id> --reason="..."  # only when the work is actually complete
bd export -o .beads/issues.jsonl   # immediately before git add-ing task state
```

Never run `bd import --reinit-local`, and never export with `--include-memories`/`--all`
(`bd remember` notes are clone-local, not shared).

## Pre-commit doc checks

Activate once per clone:

```sh
git config core.hooksPath .beads/hooks
```

On commits touching `docs/`, `.claude/skills/`, READMEs, `AGENTS.md`/`CLAUDE.md`/
`CONTRIBUTING.md`, or the `v2/` slice docs, the hook runs `docs/check-lessons.sh` and
`docs/check-links.py`. Run them by hand mid-change too; `--no-verify` bypasses.

## Docs

[docs/README.md](docs/README.md) is the map. In short:

- `docs/planning/` — active plans; `docs/archive/` — shipped or abandoned ones, kept as history.
- `docs/lessons/` — non-obvious gotchas, each entry with `Tags:`/`Applies-when:` lines; filing
  rules in [docs/lessons/README.md](docs/lessons/README.md).
- `docs/log/` — dated file plus a `docs/log/INDEX.md` row when a milestone closes or pauses.
- Cite other docs as `[[id]]` (each doc has an `Id:` line under its H1), not by path.
  [docs/_ids.md](docs/_ids.md) maps ids to current paths; it's generated, don't hand-edit.

## Quality gates

- `npm run build` in `v2/` (bake + `tsc` + Vite build) must pass before finishing.
- Check the change in the running app (`npm run dev`) — there's no automated test suite.
