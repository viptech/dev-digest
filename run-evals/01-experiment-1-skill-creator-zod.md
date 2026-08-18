# Крок 1 — Експеримент 1: Skill Creator на скілі `zod`

**Дата:** 2026-08-18
**Коміт:** `6522bfb` feat(zod-eval): Experiment 1 — Skill Creator run on the zod skill
**Інструмент:** плагін `skill-creator` (Anthropic), не пакет `evals/`.

## Що зроблено

1. Дві фікстури з по 3 навмисно закладених порушеннях кожна, **без жодних
   коментарів** про те, що там за проблеми (вимога лаби):
   - `.claude/skills/zod-workspace/fixtures/user-profile-schema.ts` —
     `z.any()` на `metadata`, `.parse()` на untrusted `req.body` без обробки,
     відсутній `.strict()`.
   - `.claude/skills/zod-workspace/fixtures/checkout-form-schema.ts` —
     `throw` усередині `.refine()`, ручний `interface` замість `z.infer`,
     `email: z.string()` без `.email()`.
2. 2 test prompts (`.claude/skills/zod/evals/evals.json`), кожен зі своєю
   фікстурою.
3. Повторні trials: 2 кейси × (`with_skill` + `without_skill`) × 2 прогони =
   8 живих LLM-сесій.
4. Грейдинг проти assertions + одна bonus-assertion, додана постфактум під
   час грейдингу (бо саме вона виявилась дискримінуючою — див. нижче).
5. Агрегація: `python -m scripts.aggregate_benchmark <workspace>/iteration-1
   --skill-name zod`.
6. Viewer: `eval-viewer/generate_review.py --static ...` (відкрито локально
   через `open`).

## Результат (benchmark)

| Метрика | З скілом | Без скіла | Дельта |
|---|---|---|---|
| Pass rate | 100% ± 0% | 79% ± 14% | +0.21 |
| Час | 154.9с ± 17.2с | 131.7с ± 20.1с | +23.2с |
| Токени | 62 737 ± 4 967 | 39 356 ± 818 | +23 381 (+60%) |

Дані: `.claude/skills/zod-workspace/iteration-1/benchmark.json` /
`benchmark.md`. Повні рецензії (8 шт.) — `.claude/skills/zod-workspace/
iteration-1/eval-{1,2}-*/{with,without}_skill/run-{1,2}/outputs/review.md`.

## Головний висновок

**3 базові assertions майже не дискримінували** — `without_skill` ловив їх
майже так само стабільно (відомі Zod-запахи, сильний baseline і без скіла).
Реальний, відтворюваний (2/2 vs 0/2) розрив знайдено вже під час грейдингу,
не заздалегідь: в обох `with_skill`-прогонах чекаут-кейсу модель самостійно
виявила, що `.refine()` перетворює схему на `ZodEffects` і блокує
`.pick()/.omit()/.extend()` — прямо релевантно промпту ("схему плануємо
перевикористати"). Жоден `without_skill`-прогон цього не побачив.

Другорядний сигнал: 1 з 2 `without_skill`-прогонів першого кейсу пропустив
`.strict()`-знахідку — baseline не стабільний навіть на "легких" запахах.

## Знайдені баги інструменту (не наші, зовнішні — записано в `INSIGHTS.md`)

`skill-creator`'s `scripts/aggregate_benchmark.py`:
1. `benchmark_dir.glob("eval-*")` ігнорує описово названі теки (`no eval
   directories found` без попередження) — обхід: префіксувати `eval-N-`.
2. Токени зануляються, якщо `grading.json` сам містить свій `timing` ключ —
   обхід: не класти `total_duration_seconds` у `grading.json`, лишати лише
   в сусідньому `timing.json`.

Деталі й доказ (`file:line`) — `../INSIGHTS.md`, записи `2026-08-18 · gotcha`.
