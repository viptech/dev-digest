# RunCostBadge — план реалізації

**Дата:** 2026-07-28
**Статус:** до затвердження
**Специфікація:** [`../specs/2026-07-28-run-cost-badge-design.md`](../specs/2026-07-28-run-cost-badge-design.md)

Коротко: `reviewer-core` уже повертає `ReviewOutcome.costUsd`; коміт `d45ab0d`
вирізав збереження й показ. План повертає колонку БД, протягує число через
контракти й додає його в чотири місця UI.

---

## 1. Схема + міграція (server)

- `server/src/db/schema/runs.ts` — повернути `costUsd: doublePrecision('cost_usd')`
  у `agentRuns` (+ імпорт `doublePrecision` із `drizzle-orm/pg-core`).
- `cd server && pnpm db:generate` → нова міграція `0010_*.sql`
  (`ALTER TABLE "agent_runs" ADD COLUMN "cost_usd" double precision;`).
- **Не редагувати** `0009_complex_runaways.sql` — вона вже застосована
  (`CLAUDE.md`, розділ «Do not touch»).
- Бекфілу немає: старі прогони лишаються `NULL` → «—».

## 2. Контракти

Редагувати **обидві** вендорені копії (`server/src/vendor/shared/` і
`client/src/vendor/shared/`) — вони синхронізуються вручну.

- `contracts/trace.ts`:
  - `RunStats.cost_usd: z.number().nullish()` — саме `nullish`, а не `nullable`:
    вже збережені `run_traces`-документи поля не мають, а `GET /runs/:id/trace`
    віддає jsonb як є (`server/src/modules/reviews/routes.ts:121`), тож
    `nullable` зламав би `server/test/contracts.test.ts:157`;
  - `RunSummary.cost_usd: z.number().nullable()` — це колонка БД.
- `contracts/platform.ts`: `PrMeta.cost_usd: z.number().nullish()` — поряд зі
  `score`, з таким самим коментарем «list endpoint only».

## 3. Server — запис і читання

- `server/src/modules/reviews/repository/run.repo.ts`:
  - `completeAgentRun(...)` — повернути `costUsd: number | null` у сигнатуру
    `values` і в `.set({...})`;
  - `listRunsForPull` — додати `cost_usd: run.costUsd` у мапінг.
- `server/src/modules/reviews/repository.ts:155` — те саме поле у фасадній
  сигнатурі.
- `server/src/modules/reviews/run-executor.ts`:
  - `const { tokensIn, tokensOut, costUsd, grounding } = outcome;`
  - передати `costUsd` у `completeAgentRun` і `cost_usd: costUsd` у `trace.stats`;
  - усі три шляхи помилок — pre-work fail (~`:80`), per-run catch (~`:300`),
    синтетичний трейс (~`:421`) — отримують `costUsd: null` / `cost_usd: null`.
- `server/src/modules/pulls/routes.ts` (`GET /repos/:id/pulls`) — після блоку
  `latestReviewByPr` (`:114-130`) додати такий самий за стилем блок агрегації:
  один запит `select({ prId, cost: sum(t.agentRuns.costUsd) })` +
  `where(inArray(t.agentRuns.prId, prIds))` + `groupBy(t.agentRuns.prId)`.
  **Увага:** drizzle `sum()` повертає `string | null` → `Number(...)` з
  перевіркою на `null`. Далі `cost_usd: costByPr.get(r.id) ?? null` у мапінгу
  (`:155`).

## 4. Client — компонент і чотири місця

**Новий компонент** `client/src/components/run-cost-badge/`
(`RunCostBadge.tsx` + `helpers.ts` + `index.ts` + тест) — пропси, види й правила
відображення описані у специфікації.

- **Список PR** — `client/src/app/repos/[repoId]/pulls/constants.ts`: додати
  `"cost"` у `COLUMN_KEYS` перед `"updated"` і розширити `GRID`
  (`"1fr 132px 92px 60px 118px 78px"` → додати колонку ~`78px` під COST).
  `_components/PRRow/PRRow.tsx`: клітинка з
  `<RunCostBadge costUsd={pr.cost_usd} />` перед `updatedCell`.
- **Таймлайн Agent runs** — `pulls/[number]/_components/RunHistory/RunHistory.tsx:198`:
  у правій колонці над часом додати
  `{settled && <RunCostBadge variant="detailed" tokenFormat="total" … />}`.
- **Плашка вердикту** — `_components/VerdictBanner/VerdictBanner.tsx`: новий
  опційний проп `cost?: { costUsd, tokensIn, tokensOut }`, рендериться рядком
  під `summary` через `variant="detailed"`. Дані: `ReviewRunAccordion.tsx:140`
  зіставляє `review.run_id` з `RunSummary` зі вже наявного на сторінці
  `usePrRuns(prId)` (`pulls/[number]/page.tsx:46`) — проп `runs` треба прокинути
  в акордеон. Нема збігу → пропа немає → рядка немає.
- **Run trace drawer** — повернути четверту плитку:
  `RunTraceDrawer/helpers.ts` використовує `formatUsd`;
  `_components/TraceBody/TraceBody.tsx:65` →
  `<Stat label={t("trace.stat.cost")} val={formatUsd(stats.cost_usd)} />`
  між TOKENS і FINDINGS.
- **i18n** (`client/messages/en/`): `runs.json` → повернути
  `trace.stat.cost: "COST"`; `prReview.json` → `list.columns.cost: "Cost"`.

## 5. Тести

- **Новий** `RunCostBadge.test.tsx`: `$0.06 / $0.014 / $0.0013`; `null → "—"`
  (явна перевірка, що **не** `$0.00`); обидва види й обидва `tokenFormat`.
- Оновити фікстури, з яких `d45ab0d` поле прибрав:
  `RunHistory.test.tsx:28` (`cost_usd: null`),
  `RunTraceDrawer.test.tsx:10` (`cost_usd: 0.06`).
- `server/test/reviews.it.test.ts` (~`:206`): ассерт, що рядок `agent_runs`
  після успішного прогону має ненульовий `cost_usd` — mock-провайдер уже віддає
  `costUsd: 0.001` (`server/src/adapters/mocks.ts:85`).
- `server/test/contracts.test.ts` — переконатися, що `RunTrace.parse` **без**
  `cost_usd` і далі проходить (це перевірка вибору `nullish`).

## 6. Документація

Наприкінці реалізації — скіл `engineering-insights` (вимога `CLAUDE.md`), як
мінімум запис про «`nullish` для полів, що додаються в уже збережені
jsonb-документи трейсів».

---

## Verification

```sh
./scripts/dev.sh --no-seed                          # або: docker compose up -d
cd server && pnpm db:migrate                        # застосувати 0010
cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd server && pnpm exec vitest run .it.test          # потрібен Docker
cd client && pnpm typecheck && pnpm test
cd reviewer-core && npm run typecheck               # має лишитись без змін
```

Ручна перевірка в UI (`http://localhost:3000`):

1. Запустити ревʼю на PR → у таймлайні Agent runs зʼявляється `N tok · $X`.
2. Відкрити трейс цього прогону → плитка COST показує ту саму суму.
3. Розгорнути акордеон ревʼю → у плашці вердикту рядок `$X · in→out`.
4. Повернутись у список PR → колонка COST = сума по всіх прогонах цього PR.
5. PR без прогонів і прогін, зроблений **до** міграції → «—», а не `$0.00`.
6. Перезавантажити сторінку → числа лишаються (беруться з БД, не з SSE).
