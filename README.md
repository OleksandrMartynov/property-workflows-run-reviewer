# Тижневий огляд запусків — віртуальний працівник (бонус WS10, шлях 1)

Віртуальний працівник для **синтетичної** агенції з управління нерухомістю, що веде повторювані процеси
(заселення, ремонт, виселення, рахунки) шаблонами й запусками. Щоп'ятниці перед розсилкою він перевіряє чернетку
тижневого дайджесту запусків проти експорту застосунку й правил продукту і пише звіт для адміністратора. Розсилає
дайджест, нагадує виконавцям і перепризначає задачі **лише людина**.

Рушій — Claude Code на власній підписці автора (особисте використання): скіл-оркестратор `run-reviewer`,
субагент-перевіряльник `run-review-verifier` у чистому контексті, скрипт `scripts/review.mjs`, що рахує, і запуск без
людини `claude -p … --permission-mode dontAsk`. Дані — лише вигадані (`*@example.test`); жодних ключів, прод-доступів
і даних справжнього продукту.

**Звіт для здачі:** [`docs/worker/README.md`](docs/worker/README.md) · межі й ін'єкція: [`docs/worker/security.md`](docs/worker/security.md)
· журнали запусків: [`docs/worker/runs/`](docs/worker/runs/).

## Файли

```
AGENTS.md                                роль, ієрархія доказів, стани OK / ПРОБЛЕМИ / НЕ ПЕРЕВІРЕНО, межі
CLAUDE.md                                один рядок @AGENTS.md
.claude/skills/run-reviewer/SKILL.md     оркестратор: A (арифметика), B (експорт і правила), D (перевіряльник), звіт
.claude/agents/run-review-verifier.md    перевіряльник: Read, Grep, Glob, Bash; без запису; фіксований вердикт
.claude/settings.json                    вузький allow / deny
scripts/review.mjs                       check-digest · review · check-report; таблиця + ###JSON###, коди 0 / 1 / 2
references/rules.md, policy.json         правила ролі, поріг застрягання (7 днів), ролі run manager
data/2026-W44 … 2026-W46                 golden data: чистий тиждень, закладені помилки, ін'єкція
tests/                                   еталон golden/expected.json, тести без моделі, оцінювач звіту (працівнику закрито)
run.sh, run-golden.sh                    запуск без людини; прогін усіх golden-наборів з оцінкою
out/                                     звіти працівника й JSON запусків (у .gitignore)
docs/worker/                             звіт для здачі, K13, копії журналів запусків
```

## Перевірка без моделі

```bash
npm test                                                   # 11 тестів: golden data, межі, check-report
node scripts/review.mjs check-digest data/2026-W45; echo $? # 0 — арифметика дайджесту узгоджена (пастка)
node scripts/review.mjs review data/2026-W45; echo $?       # 1 — ПРОБЛЕМИ (7)
node scripts/review.mjs review ../; echo $?                 # 2 — тека поза data/
```

## Запуск

Потрібні Node 24 і Claude Code з входом у підписку (`claude`, потім `/login`).

```bash
claude                          # інтерактивно: «/run-reviewer data/2026-W45» або «перевір дайджест за 45-й тиждень»
./run.sh 2026-W45               # без людини: JSON запуску в out/runs/, звіт у out/
./run-golden.sh                 # усі три golden-набори + оцінка кожного звіту проти tests/golden/expected.json
```

Розклад (macOS, щоп'ятниці о 16:00; тиждень — поточний ISO-тиждень):

```cron
0 16 * * 5 cd /шлях/до/property-workflows-run-reviewer && ./run.sh "$(date +\%G-W\%V)" >> out/cron.log 2>&1
```

## Політика

Підписка Claude — для особистої роботи. Працівник для інших людей агенції — це вже продукт, і він потребує
автентифікації API-ключем, а не входу через claude.ai. Ключі й токени — лише в `.env` (у `.gitignore`) чи GitHub
Secrets; працівнику вони не потрібні.

Шаблон — `materials/worker-claude-code/` з [домашки WS10](https://github.com/koldovsky/2026-quitcode-10-ai-features-hw)
(MIT); роль, скрипт, дані й перевірки — власні.
