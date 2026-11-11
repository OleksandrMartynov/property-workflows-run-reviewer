#!/usr/bin/env bash
# Запуск віртуального працівника без людини за клавіатурою (cron, CI): claude -p («print», headless).
# Вхід — ваша підписка Claude (claude /login один раз). Лише для ОСОБИСТОГО використання:
# працівник для інших людей — це продукт, і він потребує автентифікації API-ключем.
#
#   ./run.sh                  # тиждень за замовчуванням data/2026-W45
#   ./run.sh 2026-W46         # інший тиждень
#   CLAUDE_MODEL=sonnet ./run.sh 2026-W45   # явна модель (інакше — модель за замовчуванням вашого Claude Code)
#
# Без --bare: --bare пропускає CLAUDE.md, скіли, .claude/agents і хуки та не читає вхід підпискою —
# працівника без них немає. Запускайте лише з цієї теки: .claude/settings.json діє лише тут.
set -euo pipefail
cd "$(dirname "$0")"
export MSYS_NO_PATHCONV=1 # Git Bash на Windows не перетворює «/run-reviewer» на шлях

WEEK="${1:-2026-W45}"
case "$WEEK" in [0-9][0-9][0-9][0-9]-W[0-9][0-9]) ;; *) echo "Тиждень має бути РРРР-Wтт: $WEEK" >&2; exit 2;; esac
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
STAMP="$(date +%Y-%m-%dT%H-%M-%S)"
OUT="out/runs/${STAMP}-${WEEK}.json"
mkdir -p out/runs

# --permission-mode dontAsk: усе, що не дозволено явно, — відмова (без людини нема кому натиснути «так»).
# --allowedTools: те саме, що allow у .claude/settings.json; простого «Read» тут свідомо немає — він дозволив би
#   читати будь-який файл на диску; читання в межах теки дозволене і так, а deny закриває .env*, tests/, docs/.
# --max-turns: стеля кроків; --output-format json: результат, num_turns, total_cost_usd, permission_denials.
set +e
"$CLAUDE_BIN" -p "/run-reviewer data/${WEEK}" \
  --permission-mode dontAsk \
  --allowedTools "Skill(run-reviewer),Skill(run-reviewer *),Agent(run-review-verifier),Bash(node scripts/review.mjs *),Edit(/out/**)" \
  --max-turns 30 \
  ${CLAUDE_MODEL:+--model "$CLAUDE_MODEL"} \
  --output-format json \
  > "$OUT"
code=$?
set -e

echo "Запуск: $OUT (код виходу ${code}); звіт — новий файл out/*-run-review-${WEEK}.md"
exit "$code"
