#!/usr/bin/env bash
# Merge pull requests into main one by one, in the order given, each only once every
# check on it has finished and passed (or was skipped) and GitHub calls it MERGEABLE.
# Merges with a merge commit, pinned to the head that was checked (--match-head-commit),
# so a push that lands while waiting is never merged unchecked.
#
#   merge-in-order.sh 43 44 45 46
#
# Stacked PRs: retarget each to main (`gh pr edit N --base main`) once the PR under it
# has merged; this script refuses a PR whose base isn't main, because `gh pr merge` would
# merge it into the feature branch, not into main.
#
# Exit 0: all merged (an already-merged PR counts). Exit 2: a PR conflicts with main
# (its owner rebases it; rerun with the remaining PRs). Exit 3: a PR's base isn't main.
# Exit 1: anything else (a failed check, new commits while waiting, gh errors).
set -uo pipefail
[ $# -ge 1 ] || { echo "usage: $0 PR [PR...]"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Writes "<name>\t<bucket>" lines (bucket: pass, fail, pending, skipping, cancel) to
# $TMP/checks. JSON output, because plain `gh pr checks` exits 1 on a failed check and
# 8 while any is pending, which can't be told apart from a gh error.
read_checks() { # $1 pr; 0 = read
  gh pr checks "$1" --json name,bucket --jq '.[] | "\(.name)\t\(.bucket)"' \
    >"$TMP/checks" 2>/dev/null && [ -s "$TMP/checks" ]
}

for pr in "$@"; do
  title=$(gh pr view "$pr" --json title --jq .title) || { echo "#$pr: cannot read"; exit 1; }
  echo "== #$pr $title"
  if [ "$(gh pr view "$pr" --json state --jq .state)" = MERGED ]; then
    echo "#$pr already merged"; continue
  fi
  base=$(gh pr view "$pr" --json baseRefName --jq .baseRefName)
  [ "$base" = main ] || { echo "#$pr targets $base, not main: gh pr edit $pr --base main, then rerun"; exit 3; }
  head=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)

  # up to ~1 h (the Windows installer alone takes 11-19 min); stop early on a failure
  finished=no
  for _ in $(seq 1 80); do
    if read_checks "$pr"; then
      if awk -F'\t' '{print $2}' "$TMP/checks" | grep -qxE 'fail|cancel'; then finished=yes; break; fi
      if ! awk -F'\t' '{print $2}' "$TMP/checks" | grep -qx pending; then finished=yes; break; fi
    fi
    sleep 45
  done
  [ "$finished" = yes ] || { echo "#$pr: checks did not finish within the hour"; exit 1; }
  awk -F'\t' '$2!="pass"{print "  "$1"\t"$2}' "$TMP/checks"
  if awk -F'\t' '{print $2}' "$TMP/checks" | grep -qvxE 'pass|skipping'; then
    echo "#$pr: a check failed or was cancelled; stopping"; exit 1
  fi
  [ "$(gh pr view "$pr" --json headRefOid --jq .headRefOid)" = "$head" ] ||
    { echo "#$pr: new commits arrived while waiting; rerun to check them"; exit 1; }

  state=UNKNOWN
  for _ in $(seq 1 20); do
    state=$(gh pr view "$pr" --json mergeable --jq .mergeable)
    [ "$state" = MERGEABLE ] && break
    [ "$state" = CONFLICTING ] && { echo "#$pr CONFLICTS with main: rebase it, then rerun"; exit 2; }
    sleep 10
  done
  [ "$state" = MERGEABLE ] || { echo "#$pr: mergeable=$state"; exit 1; }
  gh pr merge "$pr" --merge --match-head-commit "$head" || { echo "#$pr: merge failed"; exit 1; }
  for _ in $(seq 1 20); do
    [ "$(gh pr view "$pr" --json state --jq .state)" = MERGED ] && break
    sleep 6
  done
  echo "#$pr MERGED ($head)"
done
