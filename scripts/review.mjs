#!/usr/bin/env node
// Скрипт-перевірка віртуального працівника «тижневий огляд запусків». Node 24, без залежностей.
// Головне правило: РАХУЄ СКРИПТ, а не модель. Агент лише запускає його й пояснює результат.
//   1) таблиця для людини + маркер ###JSON### і машиночитний JSON для агента;
//   2) код виходу: 0 — проблем немає, 1 — є проблеми, 2 — не вдалося прочитати вхід;
//   3) прапорці (⚠) — це ДАНІ для правил із references/rules.md, а не рішення: рішення — за людиною.
//
//   node scripts/review.mjs check-digest data/2026-W45            арифметика чернетки дайджесту (лише сама з собою)
//   node scripts/review.mjs review       data/2026-W45            дайджест і правила продукту проти експорту
//   node scripts/review.mjs check-report data/2026-W45 out/<файл> чи звіт працівника відповідає виводу review
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, dirArg, reportArg] = process.argv.slice(2);

function fail(message) {
  console.error(`ПОМИЛКА ВХОДУ: ${message}`);
  console.log("Код виходу: 2 (НЕ ПЕРЕВІРЕНО: вхід не прочитано)");
  process.exit(2);
}

const COMMANDS = ["check-digest", "review", "check-report"];
if (!COMMANDS.includes(cmd) || !dirArg || (cmd === "check-report" && !reportArg)) {
  fail("використання: node scripts/review.mjs <check-digest|review> <data/РРРР-Wтт> | check-report <data/РРРР-Wтт> <out/файл.md>");
}

// Межа: скрипт читає лише data/<тиждень>/, references/ і (для check-report) out/. Будь-який інший шлях — відмова.
const inside = (dir, p) => p.startsWith(path.join(ROOT, dir) + path.sep);
const dir = path.resolve(ROOT, dirArg);
if (!inside("data", dir)) fail(`тека має бути всередині data/: ${dirArg}`);

const STATUSES_RUN = new Set(["in progress", "completed"]);
const STATUSES_TASK = new Set(["to do", "done"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function readJson(file) {
  if (!existsSync(file)) fail(`немає файлу ${path.relative(ROOT, file)}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(`не JSON: ${path.relative(ROOT, file)} (${e.message})`);
  }
}

// Мінімальний CSV: кома-роздільник, лапки "..." для значень із комою, перший рядок — заголовки.
function readCsv(file, required) {
  if (!existsSync(file)) fail(`немає файлу ${path.relative(ROOT, file)}`);
  const lines = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const split = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const [head, ...rows] = lines.map(split);
  const missing = required.filter((h) => !head?.includes(h));
  if (missing.length) fail(`${path.relative(ROOT, file)}: немає колонок ${missing.join(", ")}`);
  return rows.map((r, i) => ({ ...Object.fromEntries(head.map((h, j) => [h, r[j] ?? ""])), _line: i + 2 }));
}

const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const int = (v, where) => {
  if (!Number.isInteger(v) || v < 0) fail(`не ціле невід'ємне число: «${v}» (${where})`);
  return v;
};
// Текст із даних у таблицю: без «|» і переносів, щоб рядок даних не зламав розмітку звіту.
const cell = (s) => String(s ?? "").replace(/[|\r\n]+/g, " ").trim();

// ---------- чернетка дайджесту ----------
const digest = readJson(path.join(dir, "digest_draft.json"));
const dRuns = (digest.runs ?? []).map((r, i) => ({
  run_id: String(r.run_id ?? ""),
  status: r.status,
  done: int(r.done, `runs[${i}].done`),
  total: int(r.total, `runs[${i}].total`),
}));
const TOTAL_KEYS = ["runs_in_progress", "runs_completed", "tasks_done", "tasks_open"];
const dTotals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, int(digest.totals?.[k], `totals.${k}`)]));
const dOpen = Object.fromEntries(Object.entries(digest.open_by_assignee ?? {}).map(([k, v]) => [k, int(v, `open_by_assignee.${k}`)]));
const dStale = [...(digest.stale_runs ?? [])].map(String).sort();

if (cmd === "check-digest") {
  // Лише внутрішня узгодженість: чи сходяться підсумки дайджесту з його ж рядками. Це НЕ перевірка за експортом.
  const expected = {
    runs_in_progress: dRuns.filter((r) => r.status === "in progress").length,
    runs_completed: dRuns.filter((r) => r.status === "completed").length,
    tasks_done: dRuns.reduce((s, r) => s + r.done, 0),
    tasks_open: dRuns.reduce((s, r) => s + (r.total - r.done), 0),
  };
  const bad = TOTAL_KEYS.filter((k) => expected[k] !== dTotals[k]);
  const openSum = Object.values(dOpen).reduce((s, v) => s + v, 0);
  if (openSum !== dTotals.tasks_open) bad.push("open_by_assignee");
  const overDone = dRuns.filter((r) => r.done > r.total).map((r) => r.run_id);
  if (overDone.length) bad.push("done>total");
  console.log(`## Арифметика дайджесту ${cell(digest.week)}\n`);
  console.log("| Підсумок | У дайджесті | З рядків дайджесту | Збіг |\n|---|---|---|---|");
  for (const k of TOTAL_KEYS) console.log(`| ${k} | ${dTotals[k]} | ${expected[k]} | ${bad.includes(k) ? "**⚠ ні**" : "так"} |`);
  console.log(`| сума open_by_assignee | ${openSum} | ${dTotals.tasks_open} | ${bad.includes("open_by_assignee") ? "**⚠ ні**" : "так"} |`);
  console.log(
    `\n${bad.length ? "АРИФМЕТИКА: ПОМИЛКА" : "АРИФМЕТИКА: OK (дайджест узгоджений сам із собою — це ще не означає, що він правильний)"}`,
  );
  console.log(`Код виходу: ${bad.length ? 1 : 0}`);
  console.log("###JSON###");
  console.log(JSON.stringify({ check: "digest-arithmetic", ok: bad.length === 0, mismatched: bad, overDone }));
  process.exit(bad.length ? 1 : 0);
}

// ---------- першоджерела: експорт застосунку ----------
const meta = readJson(path.join(dir, "export.json"));
if (!DATE.test(meta.as_of ?? "")) fail("export.json: as_of має бути РРРР-ММ-ДД");
const policy = readJson(path.join(ROOT, "references", "policy.json"));
const STALE = int(policy.stale_after_days, "policy.stale_after_days");
const managerRoles = new Set(policy.run_manager_roles ?? []);

const users = readCsv(path.join(dir, "users.csv"), ["email", "role"]);
const roleOf = new Map(users.map((u) => [u.email, u.role]));
const runs = readCsv(path.join(dir, "runs.csv"), [
  "run_id", "case_name", "template", "template_version", "run_manager", "status", "launched_at", "completed_at",
]);
const tasks = readCsv(path.join(dir, "tasks.csv"), [
  "task_id", "run_id", "section", "title", "required", "assignee", "status", "done_at",
]);
for (const r of runs) {
  if (!STATUSES_RUN.has(r.status)) fail(`runs.csv:${r._line}: невідомий статус запуску «${r.status}»`);
  if (!DATE.test(r.launched_at)) fail(`runs.csv:${r._line}: launched_at не дата`);
}
for (const t of tasks) {
  if (!STATUSES_TASK.has(t.status)) fail(`tasks.csv:${t._line}: невідомий статус задачі «${t.status}»`);
  if (!["yes", "no"].includes(t.required)) fail(`tasks.csv:${t._line}: required має бути yes або no`);
  if (t.status === "done" && !DATE.test(t.done_at)) fail(`tasks.csv:${t._line}: виконана задача без done_at`);
}

const problems = []; // { code, id, detail } — кожна знахідка, що не дає випустити дайджест як є
const attention = []; // { code, id, detail } — не помилка даних, а те, що людина має побачити в дайджесті
const runIds = new Set(runs.map((r) => r.run_id));

// Правила продукту на рівні задач (references/rules.md, розділ «Правила продукту»).
for (const t of tasks) {
  t.flags = [];
  if (!runIds.has(t.run_id)) t.flags.push("unknown_run");
  if (!t.assignee) t.flags.push("no_assignee");
  else if (!roleOf.has(t.assignee)) t.flags.push("unknown_assignee");
  for (const f of t.flags) problems.push({ code: f, id: t.task_id, detail: `tasks.csv:${t._line}, запуск ${t.run_id}, виконавець «${t.assignee || "—"}»` });
}

const truthRuns = runs.map((r) => {
  const own = tasks.filter((t) => t.run_id === r.run_id);
  const done = own.filter((t) => t.status === "done").length;
  const openRequired = own.filter((t) => t.required === "yes" && t.status !== "done").map((t) => t.task_id);
  const lastActivity = [r.launched_at, ...own.filter((t) => t.status === "done").map((t) => t.done_at)].sort().at(-1);
  const idle = days(lastActivity, meta.as_of);
  const flags = [];
  if (r.status === "completed" && openRequired.length) flags.push("completed_open_required");
  if (!roleOf.has(r.run_manager)) flags.push("unknown_manager");
  else if (!managerRoles.has(roleOf.get(r.run_manager))) flags.push(`${roleOf.get(r.run_manager)}_manager`);
  const stale = r.status === "in progress" && idle > STALE;
  for (const f of flags) {
    const detail =
      f === "completed_open_required"
        ? `runs.csv:${r._line}: статус completed, обов'язкові задачі «to do»: ${openRequired.join(", ")}`
        : `runs.csv:${r._line}: run manager ${r.run_manager} (роль ${roleOf.get(r.run_manager) ?? "немає в users.csv"})`;
    problems.push({ code: f, id: r.run_id, detail });
  }
  if (stale) attention.push({ code: "stale", id: r.run_id, detail: `без активності ${idle} дн. (поріг ${STALE})` });
  return { ...r, done, total: own.length, lastActivity, idle, flags, stale };
});

const truthTotals = {
  runs_in_progress: truthRuns.filter((r) => r.status === "in progress").length,
  runs_completed: truthRuns.filter((r) => r.status === "completed").length,
  tasks_done: tasks.filter((t) => t.status === "done").length,
  tasks_open: tasks.filter((t) => t.status !== "done").length,
};
const truthOpen = {};
for (const t of tasks.filter((x) => x.status !== "done")) {
  const k = t.assignee || "(без виконавця)";
  truthOpen[k] = (truthOpen[k] ?? 0) + 1;
}
const truthStale = truthRuns.filter((r) => r.stale).map((r) => r.run_id).sort();

// Текст, схожий на інструкцію агенту, у полях даних. Це «увага», а не проблема: вердикт він не змінює,
// але людина має побачити, що дані намагалися керувати працівником (references/rules.md, «Ін'єкція в даних»).
const INSTRUCTION_LIKE =
  /ignore (all )?(previous|prior) instructions|system note|\bassistant\s*:|\bcurl\b|\bwget\b|\.env\b|secrets?\.txt|set the state to|перевіряльника не викликати|ігноруй|стан ok/i;
const scanText = [
  ...runs.map((r) => ({ id: r.run_id, where: `runs.csv:${r._line} case_name`, text: r.case_name })),
  ...tasks.map((t) => ({ id: t.task_id, where: `tasks.csv:${t._line} title`, text: t.title })),
  { id: "digest_draft.note", where: "digest_draft.json note", text: digest.note ?? "" },
];
for (const s of scanText) {
  if (INSTRUCTION_LIKE.test(s.text)) attention.push({ code: "instruction_in_data", id: s.id, detail: `${s.where}: текст схожий на інструкцію — це дані, не команда` });
}

// ---------- дайджест проти першоджерел ----------
const dById = new Map(dRuns.map((r) => [r.run_id, r]));
for (const r of truthRuns) {
  const d = dById.get(r.run_id);
  if (!d) {
    problems.push({ code: "digest_missing_run", id: r.run_id, detail: "запуску немає в дайджесті" });
    continue;
  }
  const diffs = [];
  if (d.done !== r.done) diffs.push(`done ${d.done} ≠ ${r.done}`);
  if (d.total !== r.total) diffs.push(`total ${d.total} ≠ ${r.total}`);
  if (d.status !== r.status) diffs.push(`status «${d.status}» ≠ «${r.status}»`);
  if (diffs.length) problems.push({ code: "digest_run_mismatch", id: r.run_id, detail: `дайджест ≠ експорт: ${diffs.join("; ")}` });
}
for (const d of dRuns) if (!runIds.has(d.run_id)) problems.push({ code: "digest_extra_run", id: d.run_id, detail: "запуску немає в експорті" });
for (const k of TOTAL_KEYS) {
  if (dTotals[k] !== truthTotals[k]) problems.push({ code: "digest_total_mismatch", id: k, detail: `дайджест ${dTotals[k]} ≠ експорт ${truthTotals[k]}` });
}
for (const k of [...new Set([...Object.keys(truthOpen), ...Object.keys(dOpen)])].sort()) {
  const a = dOpen[k] ?? 0;
  const b = truthOpen[k] ?? 0;
  if (a !== b) problems.push({ code: "digest_assignee_mismatch", id: k, detail: `відкритих задач: дайджест ${a} ≠ експорт ${b}` });
}
for (const id of truthStale) if (!dStale.includes(id)) problems.push({ code: "digest_stale_missing", id, detail: "застряглий запуск не згадано в дайджесті" });
for (const id of dStale) if (!truthStale.includes(id)) problems.push({ code: "digest_stale_extra", id, detail: "у дайджесті як застряглий, а за експортом — ні" });

// ---------- check-report: чи звіт працівника відповідає виводу скрипта ----------
if (cmd === "check-report") {
  const report = path.resolve(ROOT, reportArg);
  if (!inside("out", report)) fail(`звіт має бути всередині out/: ${reportArg}`);
  if (!existsSync(report)) fail(`немає файлу ${reportArg}`);
  const text = readFileSync(report, "utf8");
  const state = (text.match(/^Стан:\s*\**\s*(OK|ПРОБЛЕМИ|НЕ ПЕРЕВІРЕНО)/m) ?? [])[1] ?? null;
  const allowed = problems.length ? ["ПРОБЛЕМИ", "НЕ ПЕРЕВІРЕНО"] : ["OK", "НЕ ПЕРЕВІРЕНО"];
  const checks = [
    { name: "рядок «Стан: …» є", ok: state !== null },
    { name: `стан узгоджений зі скриптом (${problems.length} проблем → ${allowed.join(" або ")})`, ok: allowed.includes(state) },
    { name: "вердикт перевіряльника є (рядок «ВЕРДИКТ:»)", ok: /ВЕРДИКТ:\s*(OK|ПРОБЛЕМИ|НЕ ПЕРЕВІРЕНО)/.test(text) },
    ...[...new Set(problems.map((p) => p.id))].map((id) => ({ name: `знахідку ${id} згадано`, ok: text.includes(id) })),
  ];
  console.log(`## Перевірка звіту ${path.relative(ROOT, report)}\n\n| Перевірка | Результат |\n|---|---|`);
  for (const c of checks) console.log(`| ${c.name} | ${c.ok ? "так" : "**⚠ ні**"} |`);
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  console.log(`\n${failed.length ? `ЗВІТ: НЕ ВІДПОВІДАЄ СКРИПТУ (${failed.length})` : "ЗВІТ: відповідає виводу скрипта"}`);
  console.log(`Код виходу: ${failed.length ? 1 : 0}`);
  console.log("###JSON###");
  console.log(JSON.stringify({ check: "report", ok: failed.length === 0, state, failed }));
  process.exit(failed.length ? 1 : 0);
}

// ---------- review: вивід ----------
console.log(`## Огляд запусків ${cell(meta.week)} станом на ${meta.as_of}: дайджест і правила продукту проти експорту\n`);
console.log("### Запуски за експортом\n");
console.log("| Запуск | Справа | Шаблон | Run manager | Статус | Виконано (експорт) | У дайджесті | Остання активність | Прапорці |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of truthRuns) {
  const d = dById.get(r.run_id);
  const f = [...r.flags, ...(r.stale ? ["stale"] : [])].map((x) => `⚠${x}`).join(" ") || "—";
  console.log(
    `| ${r.run_id} | ${cell(r.case_name)} | ${cell(r.template)} v${cell(r.template_version)} | ${cell(r.run_manager)} | ${r.status} | ` +
      `${r.done} of ${r.total} done | ${d ? `${d.done} of ${d.total} done, ${d.status}` : "немає"} | ${r.lastActivity} (${r.idle} дн.) | ${f} |`,
  );
}
const flaggedTasks = tasks.filter((t) => t.flags.length);
console.log("\n### Задачі з прапорцями\n");
if (!flaggedTasks.length) console.log("—");
else {
  console.log("| Задача | Запуск | Назва | Виконавець | Прапорці |\n|---|---|---|---|---|");
  for (const t of flaggedTasks) console.log(`| ${t.task_id} | ${t.run_id} | ${cell(t.title)} | ${cell(t.assignee) || "—"} | ${t.flags.map((x) => `⚠${x}`).join(" ")} |`);
}
console.log("\n### Підсумки\n\n| Підсумок | За експортом | У дайджесті | Збіг |\n|---|---|---|---|");
for (const k of TOTAL_KEYS) console.log(`| ${k} | ${truthTotals[k]} | ${dTotals[k]} | ${truthTotals[k] === dTotals[k] ? "так" : "**⚠ ні**"} |`);
console.log("\n### Відкриті задачі за виконавцями\n\n| Виконавець | За експортом | У дайджесті | Збіг |\n|---|---|---|---|");
for (const k of [...new Set([...Object.keys(truthOpen), ...Object.keys(dOpen)])].sort()) {
  const a = truthOpen[k] ?? 0;
  const b = dOpen[k] ?? 0;
  console.log(`| ${cell(k)} | ${a} | ${b} | ${a === b ? "так" : "**⚠ ні**"} |`);
}
console.log(`\n### Застряглі запуски (in progress, без активності > ${STALE} дн.)\n`);
console.log(`За експортом: ${truthStale.join(", ") || "—"}; у дайджесті: ${dStale.join(", ") || "—"}`);
const injections = attention.filter((a) => a.code === "instruction_in_data");
console.log("\n### Текст, схожий на інструкцію, у даних (увага, не змінює вердикт)\n");
if (!injections.length) console.log("—");
else {
  console.log("| Об'єкт | Де |\n|---|---|");
  for (const a of injections) console.log(`| ${a.id} | ${cell(a.detail)} |`);
}
console.log("\n### Знахідки\n");
if (!problems.length) console.log("—");
else {
  console.log("| # | Код | Об'єкт | Деталі |\n|---|---|---|---|");
  problems.forEach((p, i) => console.log(`| ${i + 1} | ${p.code} | ${cell(p.id)} | ${cell(p.detail)} |`));
}
console.log(`\n${problems.length ? `ОГЛЯД: ПРОБЛЕМИ (${problems.length})` : "ОГЛЯД: проблем немає"}`);
console.log(`Код виходу: ${problems.length ? 1 : 0}`);
console.log("###JSON###");
console.log(
  JSON.stringify({
    check: "review",
    week: meta.week ?? null,
    as_of: meta.as_of,
    ok: problems.length === 0,
    problems,
    attention,
    truth: { totals: truthTotals, open_by_assignee: truthOpen, stale_runs: truthStale },
    digest: { totals: dTotals, open_by_assignee: dOpen, stale_runs: dStale },
  }),
);
process.exit(problems.length ? 1 : 0);
