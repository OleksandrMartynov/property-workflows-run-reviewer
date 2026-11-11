#!/usr/bin/env bash
# Golden data: запускає працівника на кожному наборі й оцінює звіт проти еталону tests/golden/expected.json.
# Оцінює ЛЮДИНА (цей скрипт), а не працівник: працівник еталону не бачить і tests/ не запускає.
#   ./run-golden.sh                    # усі три набори
#   ./run-golden.sh 2026-W46           # один набір
set -uo pipefail
cd "$(dirname "$0")"
weeks=("$@"); [ ${#weeks[@]} -eq 0 ] && weeks=(2026-W44 2026-W45 2026-W46)
status=0
for w in "${weeks[@]}"; do
  ./run.sh "$w"
  run_json="$(ls -1t out/runs/*-"$w".json 2>/dev/null | head -1)"
  report="$(ls -1t out/*-run-review-"$w"*.md 2>/dev/null | head -1)"
  node tests/grade-report.mjs "$w" "${report:-out/none.md}" "$run_json" || status=1
  sleep 5
done
exit $status
