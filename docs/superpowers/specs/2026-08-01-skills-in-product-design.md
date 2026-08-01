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
8. Новий агент **Test Quality Reviewer** + два нові скіли
   (`test-quality-corner-cases`, `api-contract-change`), прив'язані до
   агентів для демонстрації контрольного експерименту.

Явно поза скоупом (інші лесони курсу): Stats/CI-таби агента, Agent
Performance dashboard, community-скіли з GitHub, автоматична інʼєкція
прийнятих conventions назад у промпт агента, імпорт з архівів (zip).

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

## 7. Seed-дані

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
  enabled → потрапляє в `prompt_assembly.skills`; лінкований, але
  `enabled: false` → не потрапляє; не лінкований → не потрапляє.
- Клієнтські компоненти (`SkillsListView`, `SkillEditor`, `SkillsTab`,
  `EvalsTab`) — RTL-тести за `TESTING.md`.
