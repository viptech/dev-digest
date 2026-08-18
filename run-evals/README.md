# run-evals — журнал лабораторної L06

Один файл на крок/експеримент лабораторної (`../../L06/04-hands-on-lab.md`).
Мета — щоб результати й висновки можна було знайти одразу, а не розкопувати
по комітах і `.claude/skills/*-workspace/`. Append-only за духом (не
переписуємо минулі висновки, лише додаємо нові файли/розділи), як і
`INSIGHTS.md`.

Кожен файл: що зроблено → команди, якими відтворити → цифри/результат →
висновок → комміт(и).

## Кроки

| # | Файл | Що | Статус |
|---|---|---|---|
| 0 | [00-setup-evals-package.md](00-setup-evals-package.md) | Підключення пакета `evals/` з `upstream/l06-evals` | ✅ |
| 1 | [01-experiment-1-skill-creator-zod.md](01-experiment-1-skill-creator-zod.md) | Експеримент 1 — Skill Creator на скілі `zod` | ✅ |
| 2 | [02-experiment-2-onion-architecture.md](02-experiment-2-onion-architecture.md) | Експеримент 2 — ламаємо `onion-architecture`, власний regression-кейс | ✅ |
| 3 | [03-experiment-3-architecture-reviewer.md](03-experiment-3-architecture-reviewer.md) | Експеримент 3 — `architecture-reviewer-strict` vs `-lite` (A/B) | ✅ |
| 4 | [04-experiment-4-workflow.md](04-experiment-4-workflow.md) | Експеримент 4 — `pnpm eval:workflow` (dispatch, activation, control/treatment) | ✅ |
| 5 | Експеримент 5 — самоперевірка в `CLAUDE.md`/`AGENTS.md` | — | ⏳ не почато |

## Пов'язане

- Домашнє завдання (окремий трек, не лаба): `docs/specs/SPEC-05-eval-pipeline.md`
- Крос-модульні знахідки (баги інструментів, gotchas): `../INSIGHTS.md`
