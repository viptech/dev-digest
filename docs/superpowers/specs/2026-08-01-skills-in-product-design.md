# Skills у продукті + Conventions extractor — дизайн

Дата: 2026-08-01
Автор: сесія Claude Code (feat/run-cost-badge)

## Контекст

Курс `dev-digest` заздалегідь заклав у стартер частину інфраструктури під
цю фічу (лесон L02 "Skills in the product · Conventions extractor"):

- DB-схема `skills`, `skill_versions`, `agent_skills`, `conventions`,
  `eval_cases`, `eval_runs` — уже існує (`server/src/db/schema/*.ts`).
- Контракти `Skill`, `SkillType`, `SkillSource`, `AgentSkillLink`,
  `ConventionCandidate`, `EvalCase`, `EvalRun` — уже в
  `server/src/vendor/shared/contracts/knowledge.ts` (і клієнтській копії).
- `server/src/modules/agents` уже вміє лінкувати/переупорядковувати скіли
  агента (`AgentsRepository.linkSkill/setSkills/linkedSkills`), але не
  володіє самими скілами (коментар у коді: "shared with A1's skills
  repository" — модуль A1 ще не написаний).
- `reviewer-core/src/prompt.ts` уже приймає `skills?: string[]` і рендерить
  окремий блок `## Skills / rules` (trusted-ish, без `wrapUntrusted`).
- **Відсутня критична ланка**: `server/src/modules/reviews/run-executor.ts`
  викликає `reviewPullRequest(...)` без поля `skills` — прив'язані скіли
  агента ніколи не резолвляться в тіла й не потрапляють у промпт. У трасі
  `prompt_assembly.skills` завжди `null`.
- `repoIntel.getConventionSamples()` (top-N файлів за рангом, без
  тестів/конфігів/міграцій) уже існує як заготовка вибірки файлів для
  conventions-екстрактора.
- `adapters/mocks.ts` документує очікуваний 2-кроковий LLM-флоу для
  конвенцій: `ConventionFileSelection` → `ConventionExtraction`.
- Nav (`client/src/vendor/ui/nav.ts`) і `activeKeyFor` вже мають ключі
  `skills`/`conventions`/`eval`, але секції "SKILLS LAB" в `NAV` ще немає.
- `AgentEditor` (`client/src/app/agents/[id]/_components/AgentEditor`) зараз
  рендерить лише таб `config`; коментар прямо каже, що наступні лесони
  додають Skills/Evals/Stats/CI.

## Скоуп цієї ітерації

Включено:
1. Сховище і список скілів (CRUD, версіонування).
2. Редактор скіла.
3. Прив'язка скілів до агента (Skills tab в Agent Editor).
4. Імпорт скіла з markdown-файлу з прев'ю перед збереженням.
5. Реальне прокидання прив'язаних enabled-скілів у промпт рев'ю
   (виправлення відсутньої ланки в `run-executor.ts`).
6. Conventions extractor (2-крокове LLM-вилучення конвенцій із коду,
   accept/reject UI).
7. Evals tab в Agent Editor (eval-кейси: diff + expected output, "Run case",
   pass/fail + recall/precision/citation_accuracy) — механізм контрольного
   експерименту.
8. Stats tab в Agent Editor (runs/cost/duration/accept-rate за 30D,
   most-used skills, findings by severity/category, run history) — п.7.
9. Новий агент **Test Quality Reviewer** + два нові скіли
   (`test-quality-corner-cases`, `api-contract-change`), прив'язані до
   агентів для демонстрації контрольного експерименту.

Явно поза скоупом (інші лесони курсу): CI-таб агента, Agent Performance
dashboard (крос-агентний dashboard — Stats тут лише per-agent), community-
скіли з GitHub, автоматична інʼєкція прийнятих conventions назад у промпт
агента, імпорт з архівів (zip).

## 1. Сервер — модуль `skills` (A1)

`server/src/modules/skills/{routes,service,repository}.ts`, за патерном
`agents`-модуля.

- `GET /skills` — список (workspace-scoped).
- `GET /skills/:id` — один скіл.
- `POST /skills` — створення (`name`, `description`, `type`, `body`,
  `source` default `'manual'`, `enabled` default `true`).
- `PUT /skills/:id` — патч; будь-яка зміна `body` пише новий рядок у
  `skill_versions` і інкрементить `version` (аналогічно `agent_versions`).
- `DELETE /skills/:id` — каскадно знімає лінки в `agent_skills`.
- `POST /skills/import` — приймає markdown-файл (multipart), парсить:
  перший `# Заголовок` → кандидат `name`, перший абзац → кандидат
  `description`, решта тексту → `body`. Повертає **не збережений** обʼєкт
  прев'ю; збереження — окремим підтвердженим `POST /skills` із
  `source: 'imported_url'` або просто `'manual'` для файлового імпорту
  (source enum лишається як є — файловий імпорт трактуємо як `manual`,
  бо `imported_url` семантично про URL). Ніякої обробки виконуваних частин
  файлу — приймається лише текст, різні розширення окрім `.md`/`.markdown`
  відхиляються 400-кою.
- Реєстрація в `server/src/modules/index.ts`.

## 2. Прокидання скілів у промпт

У `run-executor.ts`, перед викликом `reviewPullRequest`, додається крок:

```
const links = await this.agentsService.skillLinks(agent.id); // ordered
const enabledBodies = await this.skillsService.resolveBodies(
  links.filter(l => /* skill.enabled */).map(l => l.skill_id)
); // order preserved
```

`AgentsRepository.linkedSkills` уже повертає повний ряд скіла (`t.skills`),
включно з `enabled` — фільтрація на рівні сервісу без додаткових запитів.
Результат передається як `skills: enabledBodies` у `reviewPullRequest(...)`.
Це вмикає:
- реальний блок `prompt_assembly.skills` у трасі замість `null`;
- вимкнений (на рівні скіла або відв'язаний) скіл ніколи не потрапляє в
  промпт — включно з fallback-трасою (`traceFromBuffer`), де поле
  лишається `null`, бо це шлях помилки ще до резолву скілів.

Додатково: `agent_runs` отримує нову колонку `skill_ids jsonb` (нова
міграція, `pnpm db:generate`), яку `run-executor` заповнює ID-шками
резолвлених скілів (ті самі, що пішли в `enabledBodies`) при
`completeAgentRun`. Це єдине персистентне джерело "які скіли реально
використав цей ран" — потрібне для Stats tab (п.7, "Most-used skills") і
дешевше/точніше, ніж парсити `run_traces.trace.prompt_assembly.skills`
заднім числом.

## 3. Клієнт — Skills Lab

- `client/src/vendor/ui/nav.ts`: нова секція `SKILLS LAB` з пунктами
  `Skills` і `Conventions` (додається після `WORKSPACE`, перед
  `SETTINGS_ITEM`).
- `client/src/app/skills/page.tsx` + `_components/SkillsListView`: сітка
  карток (назва, тип-бейдж, опис, toggle `enabled`), клік по картці →
  бічний preview-drawer (патерн `RunTraceDrawer`). Кнопка «Додати» з
  меню «Створити / Імпортувати».
- `_components/SkillEditor`: форма — назва, опис (підпис-підказка:
  «Опис — інтерфейс скіла для агента; формулюй директивно»), тип
  (`rubric/convention/security/custom`), тіло в markdown (textarea).
- `_components/ImportSkillModal`: вибір `.md`-файлу → `POST
  /skills/import` → редагований прев'ю (name/description/body) →
  «Зберегти» = `POST /skills`.
- `client/src/lib/hooks/skills.ts`: React Query хуки за зразком
  `hooks/agents.ts` (`useSkills`, `useSkill`, `useCreateSkill`,
  `useUpdateSkill`, `useDeleteSkill`, `useImportSkill`).

## 4. Agent Editor — таб Skills

- `AgentEditor/constants.ts`: додається `{ key: 'skills', labelKey:
  'editor.tabs.skills', icon: 'Sparkles' }` до `TABS`.
- `_components/SkillsTab`: список усіх скілів воркспейсу з чекбоксом
  (лінк/анлінк) і drag-to-reorder (order = позиція блоку в промпті).
  Виклик `POST /agents/:id/skills` (`skill_ids` для set/reorder).

## 5. Conventions extractor

- `server/src/modules/conventions/{routes,service,repository}.ts`:
  - `POST /repos/:repoId/conventions/extract` — крок 1: `getConventionSamples`
    дає top-N кандидатів-файлів; модель (через `resolveFeatureModel(...,
    'conventions')`) обирає релевантні (schemaName
    `ConventionFileSelection`). Крок 2: вміст обраних файлів →
    `completeStructured` зі schemaName `ConventionExtraction` повертає
    масив `{rule, evidence_path, evidence_snippet, confidence}`. Пишеться
    в `conventions` з `accepted: false`.
  - `GET /repos/:repoId/conventions` — список кандидатів.
  - `PUT /conventions/:id` — accept/reject/edit `rule` (`accepted`,
    `rule`).
- Клієнт: `client/src/app/conventions/page.tsx` — список кандидатів
  (rule + evidence: файл+сніпет+confidence), toggle accept/reject, кнопка
  «Extract» запускає крок 1+2 і показує прогрес.
- Прийняті конвенції в промпт агента автоматично не інжектяться в цій
  ітерації — сторінка самодостатня (видобуток + курація).

## 6. Evals tab в Agent Editor

- `server/src/modules/evals/{routes,service,repository}.ts` (`owner_kind:
  'agent'`, `owner_id: agentId`):
  - `GET/POST/PUT/DELETE /agents/:id/evals` — CRUD `eval_cases`.
  - `POST /agents/:id/evals/:caseId/run`:
    1. `parseUnifiedDiff(case.input_diff)` (наявний парсер з
       `adapters/git/diff-parser.js`) → `UnifiedDiff`.
    2. Резолвити прив'язані enabled-скіли агента (як у п.2).
    3. `reviewPullRequest({ systemPrompt: agent.system_prompt, model,
       llm, skills, diff })` — без repo-intel/callers (ізольований
       фікстурний кейс, реального репо немає).
    4. Порівняти `actual` findings з `case.expected_output`: `pass` =
       кількість збігається І кожна очікувана знахідка має відповідник за
       `file`+`severity`; `recall`/`precision` — жадібне співставлення
       1-до-1; `citation_accuracy` — частка actual-findings, чиї
       file:line потрапляють у діапазони diff-хапків (перевикористання
       `groundFindings`/`buildLineIndex` з `reviewer-core/src/grounding.ts`).
    5. Записати `eval_runs` (actual_output, pass, метрики, duration_ms,
       cost_usd), повернути клієнту.
- Клієнт: `EvalsTab` + `EvalCaseModal` (Diff/Files/PR meta таби зліва,
  `expected_output` JSON-редактор справа з валідацією, «Run case»/«Save»,
  бейдж останнього прогону — за макетом).

## 7. Stats tab в Agent Editor

Per-agent аналітика на наявних даних (`agent_runs`, `findings`, `skills` +
нова `agent_runs.skill_ids` із п.2). Без окремого крос-агентного дашборду
(Agent Performance — інший лесон); тут лише вкладка Stats конкретного
агента.

- `server/src/modules/agents` отримує `GET /agents/:id/stats?window=30d`:
  - **Totals**: `total_runs`, `avg_cost_usd`, `avg_duration_ms`,
    `accept_rate` (`SUM(findings.accepted_at IS NOT NULL) / COUNT(*)` по
    findings ревʼю цього агента за вікно, де є хоч якийсь accept/dismiss
    вердикт — findings без жодного з двох не враховуються в знаменник).
  - **Most-used skills**: групування `agent_runs.skill_ids` (unnest) за
    вікно → `% ранів, де скіл використовувався`, джойн на `skills.name`
    для підпису; топ-5.
  - **Findings by severity**: `findings`, згруповані по
    `date_trunc('week', reviews.created_at)` × `severity` — стековий бар-
    чарт по тижнях вікна.
  - **Findings by category**: кількість findings за `category` (донат).
    *Свідоме спрощення від макета*: макет показує суму `$` на категорію,
    але вартість рахується на ран, а не на знахідку — атрибуція
    $/категорія була б довільною. Використовуємо count, не $.
  - **Run history**: останні N `agent_runs` (timestamp, PR number, tokens,
    cost, findings_count, source `local|ci`) з посиланням "View trace" на
    вже наявний run-trace drawer (`RunTraceDrawer`, той самий компонент,
    що й на сторінці PR).
- Клієнт: `_components/StatsTab` — 4 stat-тайли зверху (Total Runs / Avg
  Cost per Run / Avg Duration / Accept Rate), два бар-чарти (Most-used
  skills, Most-pulled memory — **виключено**, бо Memory-фіча ще не
  збудована; замінюємо другий бар-чарт на "Findings by category" в
  компактному вигляді або лишаємо тільки Most-used skills на всю ширину),
  стековий бар-чарт Findings by severity, донат Findings by category, і
  таблиця Run history. Для чартів — паттерни/палітра з `dataviz`-скіла.
- `AgentEditor/constants.ts`: додається `{ key: 'stats', labelKey:
  'editor.tabs.stats', icon: 'BarChart' }` до `TABS` (разом зі `skills` і
  `evals` із пп. 4/6).

## 8. Seed-дані

`server/src/db/seed.ts` додає:
- Агент **Test Quality Reviewer** — перевіряє непокриті гілки, пропущені
  corner cases, надмірне мокування, флейки; `repo_intel: true`.
- Скіл **test-quality-corner-cases** (`type: 'rubric'`, `source:
  'manual'`) — прив'язаний до Test Quality Reviewer.
- Скіл **api-contract-change** (`type: 'convention'`, `source: 'manual'`)
  — прив'язаний до вже існуючого builtin-агента (Security/General
  Reviewer).
- (Опційно) по одному eval-кейсу на кожен із двох контрольних сценаріїв
  (happy-path-only тест / route-signature change) — щоб «Run case» можна
  було одразу натиснути під час ручної перевірки.

Сам контрольний експеримент (згідно з чек-листом користувача) —
**ручна дія** в готовому UI: створити/запустити eval-кейс без скіла →
відв'язати skip → зі скілом → порівняти `pass`/`actual_output` і трейс
(`prompt_assembly.skills`). Імпорт хоча б одного скіла через UI-прев'ю
(без збереження виконуваних частин) — теж ручна перевірка.

## Тестування

- `server/src/modules/skills`, `conventions`, `evals` — unit-тести
  сервісів/репозиторіїв (workspace scoping, версіонування, matching-логіка
  eval-кейсів) + integration-тест на реальний Postgres для CRUD.
- `run-executor` — оновити/додати тест, що перевіряє: скіл лінкований і
  enabled → потрапляє в `prompt_assembly.skills` і в `agent_runs.skill_ids`;
  лінкований, але `enabled: false` → не потрапляє нікуди; не лінкований →
  не потрапляє.
- `agents`-модуль (`GET /agents/:id/stats`) — unit-тест на агрегацію
  (accept_rate, most-used skills %, severity/category групування) на
  фікстурних `agent_runs`/`findings`.
- Клієнтські компоненти (`SkillsListView`, `SkillEditor`, `SkillsTab`,
  `EvalsTab`, `StatsTab`) — RTL-тести за `TESTING.md`.
