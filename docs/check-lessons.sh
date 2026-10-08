#!/bin/bash
# Guard for docs/lessons filing rules (see lessons/README.md).
# Enforces the retrieval contract: every entry carries Tags: and
# Applies-when: lines, and each file's index count matches reality.
# A top-level file's index is lessons/README.md; a file in a subdirectory
# is counted in that directory's INDEX.md. Counts are only checked when the
# index actually lists one (prose indexes predate the table shape).
# Exit 1 on any failure, so it works as a pre-commit hook or CI step.
set -u
fail=0
cd "$(dirname "$0")"
count_for() {
  grep -E '^\|' "$1" 2>/dev/null | grep -F "$2" | awk -F'|' '{gsub(/ /,"",$4); print $4}' | head -n 1
}
for f in lessons/*.md lessons/*/*.md; do
  [ -e "$f" ] || continue
  case "$f" in */README.md|*/INDEX.md) continue;; esac
  base=$(basename "$f")
  # Every ## entry must be followed by Tags: then Applies-when:
  bad=$(awk '/^## /{h=NR; next} h && NR==h+1 && !/^Tags: /{print h": missing Tags:"; h=0; next} h && NR==h+2 && !/^Applies-when: /{print h": missing Applies-when:"; h=0}' "$f")
  if [ -n "$bad" ]; then
    echo "$bad" | sed "s/^/TAGS: $base /"
    fail=1
  fi
  entries=$(grep -c '^## ' "$f")
  if [ "$f" = "lessons/$base" ]; then index="lessons/README.md"; else index="$(dirname "$f")/INDEX.md"; fi
  indexed=$(count_for "$index" "$base")
  case "$indexed" in ''|*[!0-9]*) ;; *)
    if [ "$indexed" != "$entries" ]; then
      echo "COUNT: $index says $indexed for $base, actually $entries"
      fail=1
    fi;;
  esac
done
[ "$fail" -eq 0 ] && echo "lessons OK"
exit "$fail"
