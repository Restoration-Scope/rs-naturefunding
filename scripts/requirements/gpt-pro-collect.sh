#!/bin/bash
# Collects every sent GPT Pro chat that has no answer yet (.cache/gpt-pro/sent.tsv) and stores each finished
# one with gpt-pro.ts save. Run from the main checkout; WT is the worktree that holds the data being written.
#   gpt-pro-collect.sh <worktree>        exit 0 when nothing is pending, 75 while some are still thinking
set -uo pipefail
WT="${1:?worktree}"
DIR="$(pwd -P)/.cache/gpt-pro"
pending=0
while IFS=$'\t' read -r id url _; do
  [ -f "$WT/data/requirements/gpt-pro/$id.json" ] && continue
  [ -f "$DIR/failed/$id" ] && continue
  "$WT/scripts/requirements/gpt-pro-browser.sh" collect "$id" "$url"; rc=$?
  if [ $rc -eq 75 ]; then pending=$((pending + 1)); continue; fi
  if [ $rc -ne 0 ]; then pending=$((pending + 1)); continue; fi
  if ! (cd "$WT" && bun scripts/requirements/gpt-pro.ts save "$id" "$DIR/answers/$id.txt" "$url" < /dev/null); then
    mkdir -p "$DIR/failed" && echo "$url" > "$DIR/failed/$id"
    echo "$id: answer did not parse; see $DIR/answers/$id.txt" >&2
  fi
done < "$DIR/sent.tsv"
echo "pending: $pending"
[ $pending -eq 0 ] || exit 75
