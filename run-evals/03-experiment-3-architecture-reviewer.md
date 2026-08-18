# Крок 3 — Експеримент 3: `architecture-reviewer` vs `architecture-reviewer-lite`

**Дата:** 2026-08-18

## Що зроблено

Попередньо написані кейси (`evals/agents/architecture-reviewer/*`, з
`upstream/l06-evals`) очікують rule ID (`inward-only-dependencies`,
`di-discipline`, `reviewer-core-zero-io`, `reviewer-core-ground-findings-gate`),
яких **немає** у реальному продакшн-агенті `.claude/agents/architecture-reviewer.md`
(прозовий, без ID). Ці самі ID буквально збігаються з
`exapmle_claude/.claude/agents/architecture-reviewer.md` ("альтернативне
налаштування", яке додав користувач). За рішенням користувача — будуємо
Experiment 3 на цій, rule-ID-based версії, окремо від продакшн-агента:

- `.claude/agents/architecture-reviewer-strict.md` — копія
  `exapmle_claude/.../architecture-reviewer.md`, без змін (version A).
- `.claude/agents/architecture-reviewer-lite.md` — та сама копія, мінус
  ОДНЕ правило: *"One rule citation per finding. Every finding must name
  the exact documented contract it violates."* (version B). Продакшн
  `architecture-reviewer.md` не зачеплений.
- `evals/agents/architecture-reviewer/` → перейменовано в
  `evals/agents/architecture-reviewer-strict/`, щоб назва не вводила в
  оману (не тестує продакшн-агента).

## Знайдені й пофіксені баги інструменту `evals/` (наші, в самому пакеті — не зовнішні)

1. **`run-vitest.ts` викликав `pnpm exec vitest ...`** — той самий
   pnpm-гейт з `INSIGHTS.md` (`ERR_PNPM_IGNORED_BUILDS`), тільки тепер
   всередині власного скрипта `eval:repeat`: перший прогін падав мовчки
   ("no records — run crashed", стек-трейс `pnpm.mjs` без жодного виводу
   vitest). Фікс — викликати `evals/node_modules/.bin/vitest` напряму.
2. **`delta.ts` матчив кейси за повним nodeid**, який включає назву
   `describe`-блоку. Для справжнього A/B двох агентів (`describeAgent`
   з різними назвами для strict/lite) це означало, що жоден кейс НЕ
   матчився — дельта показувала кожен кейс двічі, як "є лише в A" і
   "є лише в B", замість реального порівняння. Фікс — матчити за
   останнім сегментом nodeid (назвою самого кейса), яка справді
   однакова для обох варіантів (той самий `cases` масив, лише інший
   інжектований агент).

Обидва фікси — реальні правки в `evals/src/*`, не одноразові обходи.

## Результат (`pnpm eval:repeat ... -n 2 --label strict/lite` → `pnpm eval:delta strict lite`)

| Практика | strict | lite | Δ |
|---|---|---|---|
| цитує `reviewer-core-zero-io`/`reviewer-core-ground-findings-gate` | 100% | 100% | 0 |
| цитує `inward-only-dependencies`/`di-discipline` (checkout-diff) | 100% | 100% | 0 |
| не вигадує порушення на benign-рефакторингу | 100% | 100% | 0 |
| **не вигадує архітектурне порушення для out-of-scope security-подібної зміни** | **100%** | **50%** | **−50** |

## Головний висновок

**Цитування rule ID НЕ впало** — модель продовжує називати
`inward-only-dependencies`/`di-discipline`/`reviewer-core-zero-io` навіть
без явної вимоги "цитуй правило", бо самі ID вже задокументовані у
кожному `#### RULE: <id>` розділі Method-секції — модель просто описує
знахідку, природно посилаючись на джерело, яке щойно прочитала. Той
самий ефект надлишковості, що й в Експерименті 2.

**Але впала ІНША, реальна практика** — саме та, яку авторський коментар у
`architecture-reviewer.cases.ts` (рядки 21-25) прямо передбачав:
*"freed from 'every finding must name a documented contract', the lite
variant is more prone to fabricating a judgment/best-practice finding
where the strict variant stays silent"*. Підтвердилось: без вимоги
"кожна знахідка = цитата конкретного правила" `lite`-агент почав частіше
вигадувати архітектурні знахідки там, де правильна відповідь —
промовчати (security-подібна, але не архітектурна зміна). Це і є конкретна
пов'язана expectation, що впала — не абстрактний score.

`n=2` (обмеження `eval:repeat` заради економії токенів) — 50% тут означає
рівно 1 з 2 прогонів впав, а не стабільні 50%. Достатньо як індикативний
сигнал, недостатньо як остаточний доказ — для впевненості треба було б
`-n 5+`, свідомо не робив зараз (вартість).

## Коміти

Буде зафіксовано разом із рештою файлів цього кроку.
