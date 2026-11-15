#!/usr/bin/env bash
# Runs independent blind reviewers over DIR/items.json (from review-kit.mjs packets).
# Each reviewer is a fresh, tool-less headless Claude session that sees only the
# rubric, the scenario, the expectations and the anonymised reply.
#
#   run-reviewers.sh DIR [REVIEWERS="r1 r2 r3"] [BATCH=30] [ITEMS_FILE=items.json]
set -euo pipefail
DIR=${1:?dir}
REVIEWERS=${2:-"r1 r2 r3"}
BATCH=${3:-30}
ITEMS=${4:-items.json}
HERE=$(cd "$(dirname "$0")" && pwd)
RUBRIC="$HERE/../../../../docs/restpilot-upgrade-2026-11/AI-QUALITY-RUBRIC.md"
mkdir -p "$DIR/reviews"
N=$(node -e "console.log(require('$DIR/$ITEMS').length)")
for R in $REVIEWERS; do
  : > "$DIR/reviews/$R.jsonl"
  for ((S = 0; S < N; S += BATCH)); do
    PROMPT="$DIR/reviews/$R-$S.prompt"
    node -e '
      const fs = require("fs");
      const [tpl, rubric, items, s, b] = process.argv.slice(1);
      const all = require(items).slice(+s, +s + +b);
      const out = fs.readFileSync(tpl, "utf8").replace("{{RUBRIC}}", fs.readFileSync(rubric, "utf8")).replace("{{ITEMS}}", JSON.stringify(all, null, 1));
      process.stdout.write(out);
    ' "$HERE/reviewer-prompt.md" "$RUBRIC" "$DIR/$ITEMS" "$S" "$BATCH" > "$PROMPT"
    for TRY in 1 2; do
      if claude -p --max-turns 1 --output-format text --allowedTools "" < "$PROMPT" > "$DIR/reviews/$R-$S.out" 2> "$DIR/reviews/$R-$S.err"; then
        grep -E '^\{"rid"' "$DIR/reviews/$R-$S.out" > "$DIR/reviews/$R-$S.jsonl" || true
        GOT=$(wc -l < "$DIR/reviews/$R-$S.jsonl")
        WANT=$(node -e "console.log(Math.min(+process.argv[2], require(process.argv[1]).length - +process.argv[3]))" "$DIR/$ITEMS" "$BATCH" "$S")
        [ "$GOT" -ge "$WANT" ] && break
        echo "$R batch $S: $GOT of $WANT lines, retrying" >&2
      fi
    done
    cat "$DIR/reviews/$R-$S.jsonl" >> "$DIR/reviews/$R.jsonl"
    rm -f "$PROMPT"
  done
  echo "$R: $(wc -l < "$DIR/reviews/$R.jsonl") scores"
done
