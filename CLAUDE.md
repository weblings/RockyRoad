# Project instructions

## Comment style

Don't write paragraph-long comment blocks (Symptom/Root cause/Fix essay style). Condense to
2-3 lines max if the context can survive that without being lost — a comment nobody will read in
full during a normal review isn't helping. This applies to code comments and to entries added to
`Analysis/lessons/` (see `Analysis/lessons/README.md` for where a new entry goes).

Don't reference internal planning labels ("Phase 5", "Phase 3 detail") in comments — they go stale
fast and mean nothing to a reader without that session's context. Describe current behavior/reasoning
instead.

## Lessons learned — one location, repo-wide

`Analysis/lessons/` is the **only** lessons-learned location in this repo — for every
subproject, not just the one it happens to sit next to. Before writing a new gotcha down, check
`Analysis/lessons/README.md` for where it goes. Never start a new `LessonsLearned.md` (or
similarly named doc) elsewhere in the repo, even inside a subproject like `v2/` — a prior
session did exactly that (`v2/LessonsLearned.md`), and its entries had to be found later
via a repo-wide grep and folded back in. If you're ever unsure whether a lessons doc already
exists somewhere, `find . -iname "*lesson*"` before creating one.

**Part 2 of any lessons-capture pass: check docs, not just gotchas.** After filing whatever
gotcha prompted the capture, also check whether that same session's code change made any
README (root, `v2/README.md`, `RockyRoadImport/README.md`) claim stale — a moved/removed
feature, a changed tech-stack detail, a broken link — and fix it in the same pass rather than
leaving it for a later cleanup. This is how `v2/README.md` accumulated a dead `html2canvas`
claim and a broken `Setup.md` link in the first place.
