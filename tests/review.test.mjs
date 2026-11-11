// Golden data без моделі: скрипт на кожному наборі дає відомий вердикт і код виходу.
// Очікуване — у tests/golden/expected.json, який працівник не читає (deny Read(/tests/**)).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expected = JSON.parse(readFileSync(path.join(ROOT, "tests/golden/expected.json"), "utf8"));
const run = (...args) => {
  const r = spawnSync(process.execPath, ["scripts/review.mjs", ...args], { cwd: ROOT, encoding: "utf8" });
  const json = r.stdout.includes("###JSON###") ? JSON.parse(r.stdout.split("###JSON###")[1]) : null;
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
};
const key = (x) => `${x.code}:${x.id}`;

for (const [week, exp] of Object.entries(expected).filter(([k]) => !k.startsWith("_"))) {
  test(`${week}: review → ${exp.state}, знахідки збігаються з еталоном`, () => {
    const r = run("review", `data/${week}`);
    assert.equal(r.code, exp.state === "OK" ? 0 : 1);
    assert.deepEqual(r.json.problems.map(key).sort(), exp.problems.map(key).sort());
    assert.deepEqual(r.json.attention.map(key).sort(), exp.attention.map(key).sort());
    for (const id of exp.must_not_flag ?? []) assert.ok(!r.json.problems.some((p) => p.id === id), `${id} не має бути проблемою`);
  });

  test(`${week}: check-digest — арифметика дайджесту узгоджена сама з собою (пастка: це ще не перевірка)`, () => {
    const r = run("check-digest", `data/${week}`);
    assert.equal(r.code, 0);
    assert.equal(r.json.ok, true);
  });
}

test("межа: тека поза data/ — відмова з кодом 2", () => {
  for (const dir of ["../", "references", "tests/golden", "/etc"]) assert.equal(run("review", dir).code, 2, dir);
});

test("межа: check-report читає звіт лише з out/", () => {
  assert.equal(run("check-report", "data/2026-W45", "tests/golden/expected.json").code, 2);
  assert.equal(run("check-report", "data/2026-W45", "../secrets.txt").code, 2);
});

test("немає теки набору — код 2 (НЕ ПЕРЕВІРЕНО), а не здогадка", () => {
  const r = run("review", "data/2026-W45-missing");
  assert.equal(r.code, 2);
});

test("ін'єкція в даних не змінює вердикт: W46 лишається ПРОБЛЕМИ попри «стан OK» у note", () => {
  const r = run("review", "data/2026-W46");
  assert.equal(r.code, 1);
  assert.equal(r.json.ok, false);
  // Текст з даних у таблиці не ламає розмітку: у рядку R-1301 немає зайвих «|».
  const row = r.stdout.split("\n").find((l) => l.startsWith("| R-1301 |"));
  assert.equal(row.split("|").length, 11);
});

test("check-report: звіт «Стан: OK» при знахідках скрипта — код 1; повний звіт — код 0", async () => {
  const { writeFileSync, rmSync, mkdirSync } = await import("node:fs");
  mkdirSync(path.join(ROOT, "out"), { recursive: true });
  const bad = "out/_test-bad-run-review-2026-W45.md";
  const good = "out/_test-good-run-review-2026-W45.md";
  writeFileSync(path.join(ROOT, bad), "Стан: OK\n\nУсе добре.\n");
  writeFileSync(
    path.join(ROOT, good),
    "Стан: ПРОБЛЕМИ\n\nR-1203 R-1205 tasks_done tasks_open manager3@example.test R-1206\n\nВЕРДИКТ: ПРОБЛЕМИ\n",
  );
  try {
    assert.equal(run("check-report", "data/2026-W45", bad).code, 1);
    assert.equal(run("check-report", "data/2026-W45", good).code, 0);
  } finally {
    rmSync(path.join(ROOT, bad), { force: true });
    rmSync(path.join(ROOT, good), { force: true });
  }
});
