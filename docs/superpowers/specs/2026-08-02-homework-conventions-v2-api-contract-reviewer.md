# Homework — Conventions Extractor v2 + API Contract Reviewer — Design

Дата: 2026-08-02
Джерело: домашнє завдання L02 (GoIT AI Agentic Engineering),
https://www.edu.goit.global/uk/learn/53052469/53167848/53167992/homework

## Контекст

Гілка `feat/homework-l02` (від `feat/skills-in-product`, яка вже має Skills-ядро,
Conventions Extractor v1, Evals tab, Agent Stats tab — усі змержені в PR #3).
Це домашнє завдання суттєво розширює вже збудований Conventions Extractor і
додає нового агента-рев'ювера з експериментом "без скілів / зі скілами".

## Скоуп

1. **Conventions Extractor v2**:
   - Перемикач режиму вибірки файлів: `code` (детерміновано, вимога завдання)
     або `llm` (наявний 2-кроковий флоу з Плану B), default `code`.
   - Кандидат отримує `category` і `evidence_line`; кожен доказ верифікується
     на сервері (файл існує, рядок існує) — непідтверджені відкидаються ще до
     збереження в БД.
   - UI: явний Reject (не лише неявний "не accepted"), inline-редагування
     тексту правила, клікабельний доказ → реальний код на GitHub.
   - Нова дія "Create skill from accepted candidates" — модалка збирає
     прийняті кандидати в один скіл (`repo-conventions` за замовчуванням, назва
     редагована), лінкує до вибраного агента.
2. **Агент API Contract Reviewer** — сідиться з 4 прилінкованими скілами
   (`breaking-change`, `response-schema`, `semver-discipline`,
   `deprecation-policy`), кожен з good/bad-прикладом.
3. Контрольний експеримент (без скілів / зі скілами на PR зі зміною API) —
   ручна дія користувача в готовому UI, не автоматизується.

Поза скоупом (додаткове завдання, опційно, не блокує приймання):
імпорт скіла з URL, пакування в Claude Code plugin, прогін на власному репо,
покращення repo-intel для більшої кількості знахідок.

## 1. Сервер — режим вибірки файлів

`server/src/modules/conventions/service.ts`'s `extract(workspaceId, repoId,
samplingMode: 'code' | 'llm' = 'code')`:

- **`code`**: нова функція `getCodeOnlySamples(repoId)` у `ConventionsService`
  (чи хелпер) — бере `container.repoIntel.getConventionSamples(repoId, N)`
  (наявний метод) **плюс** прямий пошук конфігів у корені клону:
  `.eslintrc*`, `eslint.config.*`, `tsconfig*.json`, `.prettierrc*`,
  `prettier.config.*` (перевірка `existsSync` через `readFiles` — якщо файл є,
  він потрапляє в список; якщо нема — пропускаємо, без помилки). Результат
  одразу йде в крок екстракції (без LLM-кроку вибору файлів).
- **`llm`**: наявний флоу з `ConventionFileSelectionSchema` (без змін).
- Роут `POST /repos/:repoId/conventions/extract` приймає опціональне тіло
  `{ sampling_mode?: 'code' | 'llm' }`.

## 2. Схема кандидата + верифікація доказів

- `server/src/db/schema/knowledge.ts`: `conventions` отримує колонку
  `evidenceLine integer` (нова міграція, `pnpm db:generate`).
- Контракт `ConventionCandidate` (обидві копії `vendor/shared`) отримує
  `category: z.string()` і `evidence_line: z.number().int().nullish()`.
- `ConventionExtractionSchema` (LLM structured output) розширюється тими ж
  двома полями.
- Нова верифікація в `ConventionsService.extract()` після LLM-екстракції,
  перед `repo.insertMany`: для кожного кандидата — `repoIntel.readFiles(repoId,
  [candidate.evidence_path])`; якщо файл не прочитався **або**
  `evidence_line` виходить за межі кількості рядків файлу — кандидат
  відкидається (не потрапляє в `insertMany`). Це суто механічна перевірка
  існування, без семантичного порівняння вмісту рядка.

## 3. Клієнт — Reject, редагування, GitHub-посилання, "Create skill"

- `ConventionCard`: кнопка **Reject** (`PUT /conventions/:id` з `{accepted:
  false}` — поле вже підтримує це; додається лише UI-кнопка й окремий
  візуальний стан "rejected" відмінний від "ще не розглянутий"). Тут
  знадобиться третій стан кандидата: НЕ просто boolean `accepted`, а
  `pending | accepted | rejected` — оскільки поточна схема має лише
  boolean-колонку `accepted`. Рішення: додати колонку `status text` (`enum:
  ['pending','accepted','rejected']`, default `'pending'`) замість
  розширення семантики `accepted`; `accepted`-колонка лишається як є для
  зворотної сумісності з наявним кодом (`accepted = status === 'accepted'`),
  але джерело правди для UI/фільтрів — нова `status`.
- `ConventionCard`: inline-textarea для редагування `rule` перед
  прийняттям/після — `PUT /conventions/:id` з `{rule}`.
- Доказ рендериться як `<a href={githubBlobUrl} target="_blank">`, де
  `githubBlobUrl = https://github.com/${repo.full_name}/blob/${repo.default_branch}/${evidence_path}#L${evidence_line}`.
  Потрібен `repo.full_name`/`default_branch` на клієнті — вже є в `Repo`
  контракті, дістаються через наявний `useRepo`/`useActiveRepo`.
- Нова кнопка **"Create skill from accepted"** (активна, коли є ≥1
  `status==='accepted'` кандидат) → модалка `CreateSkillFromConventionsModal`:
  список прийнятих кандидатів (rejected і pending — виключені на бекенді
  фільтром `status='accepted'`), textarea з попередньо згенерованим Markdown
  (`# repo-conventions\n\n` + для кожного кандидата `- ${rule} (${evidence_path}:${evidence_line})`),
  поле назви (default `repo-conventions`), опису, select агента для
  прилінкування → `POST /skills` (source `'manual'`) → `POST
  /agents/:id/skills` (додає до вже прилінкованих).

## 4. Новий агент API Contract Reviewer (seed)

`server/src/db/seed.ts`, ідемпотентно за встановленим у файлі патерном:
- Агент **API Contract Reviewer** — системний промпт за структурою вже
  наявних built-in промптів (`# Role`, `# What to look for`, `# How to
  analyze`, `# Quality bar`, `# Severity`, `# Verdict`, `# Findings
  discipline`), фокус — зміни публічного API контракту (сигнатури роутів,
  форма відповіді, версіонування).
- 4 нові скіли, кожен — директивний опис + приклад good/bad:
  - `breaking-change` — зміна/видалення публічного контракту.
  - `response-schema` — зміни форми відповіді (типи, обов'язковість полів).
  - `semver-discipline` — коли зміна вимагає major-бампу.
  - `deprecation-policy` — позначення застарілого замість тихого видалення.
- Усі 4 прилінковані до API Contract Reviewer одразу (`agent_skills`,
  ідемпотентний upsert-патерн з наявного коду).
- Наявний скіл `api-contract-change` (Security Reviewer, з Плану A)
  лишається без змін — це окремий, простіший скіл на іншому агенті.

## Тестування

- Server: юніт-тести на верифікацію доказів (файл є/нема рядка → кандидат
  відкидається), на `getCodeOnlySamples` (конфіги знайдені/відсутні —
  degrade gracefully), інтеграційний тест на повний `code`-режим екстракції.
- Client: тести на Reject-кнопку, inline-редагування, "Create skill from
  accepted" модалку (rejected-кандидат не потрапляє в текст скіла).
- Seed: перевірка ідемпотентності (4 скіли + агент, повторний запуск — без
  дублів).
