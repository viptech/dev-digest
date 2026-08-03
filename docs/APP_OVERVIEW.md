# DevDigest — огляд застосунку

> Опис поточного стану кодової бази (гілка `feat/homework-l02`) як цілого
> продукту — не лише того, що додано за останню сесію.

## 1. Загальний опис

DevDigest — локальний (self-hosted) інструмент AI-рев'ю пул-реквестів.
Користувач підключає GitHub-репозиторій → сервер клонує його і
проіндексовує (`repo-intel`: символи, граф імпортів → "карта репо", яка
живить контекст рев'ю) → застосунок імпортує відкриті PR-и → користувач
відкриває конкретний PR і запускає рев'ю **агентом**.

**Агент** — це LLM-профіль: провайдер + модель (OpenAI / Anthropic /
OpenRouter), власний system prompt, стратегія рев'ю, поріг для CI
(`ci_fail_on`), тумблер збагачення контекстом репо. Агент аналізує diff і
повертає структуровані **findings** — потенційні проблеми з важкістю
(severity), описом, і обов'язковим посиланням на конкретний рядок diff.
Це посилання перевіряє **grounding gate**: знахідка без валідного рядка в
diff відкидається, а підсумковий score рахується вже з того, що вижило —
самозвітна оцінка моделі ігнорується. Увесь недовірений вміст (сам diff,
опис/коментарі PR) обгортається одним спільним `INJECTION_GUARD`-правилом,
яке каже моделі не виконувати інструкції, знайдені всередині цього тексту.

Із коробки застосунок має два вбудовані агенти (General, Security), а над
базовим пайплайном "diff → LLM → findings" продукт нарощує шар
**побудови й тестування самих агентів**:

- **Skills** — короткі повторно використовувані інструкції ("дивись на
  semver", "перевіряй error-handling за такою конвенцією"), які
  прив'язуються до агента і потрапляють у промпт лише коли увімкнені для
  цього агента.
- **Conventions Extractor** — автоматично витягує "домашні" конвенції коду
  репозиторію (naming, error-handling, testing...) з доказом (файл+рядок+
  сніпет) і дозволяє перетворити прийняті кандидати на новий skill.
- **Evals** — набір "PR-кейс → очікувані findings" для агента; прогін тим
  самим реальним пайплайном рев'ю, щоб побачити precision/recall до
  релізу зміни промпту чи скіла.
- **Agent Stats** — за 30 днів: які скіли агент реально використовував,
  скільки коштували прогони, розподіл findings за категоріями/важкістю.
- **API Contract Reviewer** — 5-й вбудований агент з навмисно узагальненим
  system prompt (без переліку конкретних перевірок), щоб 4 прив'язані до
  нього скіли (`breaking-change`, `response-schema`, `semver-discipline`,
  `deprecation-policy`) давали видиму різницю в рев'ю того самого агента
  залежно від того, увімкнені вони чи ні.

Продукт задуманий як навчальний курс: стартовий шаблон робить лише
"імпортувати PR і прогнати рев'ю", а кожен наступний урок додає одну
можливість. Усе перелічене вище (Skills, Conventions, Evals, Stats,
API Contract Reviewer) — це урок L02; базові Run cost badge і фільтр
findings за важкістю — L01. Ще не реалізовані уроки (Intent/Smart Diff,
MCP-сервер, Blast Radius, Onboarding-генератор, Eval pipeline/CI-export,
мультиагентне рев'ю, плагіни) описані в корені `README.md` і в схемі БД
уже мають зарезервовані, поки що порожні таблиці.

## 2. Загальна структура бекенда (`server/` — `@devdigest/api`, порт 3001)

Fastify 5 + Drizzle ORM над Postgres (pgvector). Onion/hexagonal
архітектура: домен без I/O, сервіси отримують адаптери (LLM, GitHub, git,
ast-grep, секрети) через DI-контейнер (`src/platform/container.ts`), routes
лише транслюють HTTP↔сервіс. Модуль = `routes.ts` (HTTP+zod) +
`service.ts` (оркестрація) + `repository.ts` (доступ до даних).

Потік запиту: `HTTP → plugins (helmet/cors/rate-limit/SSE) → zod-валідація
params/body → модуль (routes.ts) → service → DI-контейнер → адаптер (prod:
LLM/GitHub/git/pgvector; test: моки) → Drizzle/Postgres`, з SSE-стрімом
трейсу прогону й централізованим error-handler'ом.

Модулі в `server/src/modules/`:

| Модуль | Призначення | Основні маршрути |
|---|---|---|
| `repos` | підключення/список репозиторіїв | `POST/GET /repos`, `POST /repos/:id/refresh`, `DELETE /repos/:id` |
| `pulls` | список і деталі PR-ів | `GET /repos/:id/pulls`, `GET /pulls/:id`, коментарі |
| `polling` | періодичний опитувальник GitHub на нові PR | `POST /repos/:id/poll` |
| `repo-intel` | індексація репозиторію (skeleton, callers, "blast radius") — вмикає збагачення промпту | `GET /repos/:id/index-state`, `/resync` |
| `reviews` | запуск рев'ю, findings, трейс прогону | `POST /pulls/:id/review`, `GET /pulls/:id/runs`, `GET /runs/:id/trace`, `POST /findings/:id/(accept|dismiss)` |
| `agents` | CRUD агентів, версії конфігурації, прив'язані скіли, статистика | `GET/POST/PUT/DELETE /agents(/:id)`, `GET /agents/:id/versions`, `GET/POST /agents/:id/skills`, `GET /agents/:id/stats` |
| `skills` | сховище скілів (CRUD + імпорт) | `GET/POST/PUT/DELETE /skills(/:id)`, `POST /skills/import` |
| `conventions` | Conventions Extractor — витяг кандидатів-конвенцій з коду | `GET /repos/:repoId/conventions`, `POST /repos/:repoId/conventions/extract`, `PUT /conventions/:id` |
| `evals` | еталонні кейси й прогони для агента | `GET/POST/PUT/DELETE /agents/:id/evals`, запуск прогону |
| `settings` | API-ключі провайдерів, вибір моделі за фічею | `GET/POST /settings`, `/providers` |
| `workspace` | поточний робочий простір | `GET /workspace` |

Кілька наскрізних деталей, важливих для розуміння:

- **Wire-контракти — `snake_case`** (`head_sha`, `files_count`), хоча
  Drizzle/TS усередині `camelCase`; маппінг відбувається явно на межі
  route. Контракти лежать у `server/src/vendor/shared/contracts/` —
  і **дублюються** байт-в-байт у `client/src/vendor/shared/contracts/`
  (окремі git-копії без синхронізації — про це знає й root `INSIGHTS.md`).
- **Що бачить модель:** промпт агента (`reviewer-core/prompt.ts`)
  збирається з diff + PR title/body + (за замовчуванням, якщо
  `REPO_INTEL_ENABLED` і репозиторій проіндексований) repo-skeleton і
  нотатки про "high blast-radius" зміни + увімкнені й прив'язані скіли
  агента (`skills: string[]`, відфільтровані по `enabled`) + один спільний
  `INJECTION_GUARD`, що каже моделі: недовірений вміст (diff/опис PR/
  коментарі) — це дані, а не інструкції.
- **Grounding gate обов'язковий:** кожна знахідка мусить вказувати рядок,
  що реально є в diff — інакше відкидається, і score перераховується з
  тих, що вижили (self-reported score моделі ігнорується).
- Жоден route в проєкті не декларує `response:`-схему — Fastify не
  валідує форму відповіді, лише вхід.

## 3. Загальна структура інтерфейсу (`client/` — `@devdigest/web`, порт 3000)

Next.js 15 App Router, React Server/Client компоненти, дані через TanStack
Query hooks (`src/lib/hooks/*`) над Fastify API (`src/lib/api.ts`). Сторінки
тонкі, логіка — в колокейтед `_components/<Name>/`.

### Сторінки (`src/app/**/page.tsx`)

- **`/` (Onboarding/головна)** — точка входу; якщо немає підключених
  репозиторіїв, веде на `/onboarding` для додавання репозиторію
  (`POST /repos`).
- **`/repos/:repoId/pulls`** — список PR-ів репозиторію (`GET
  /repos/:id/pulls`), стан індексації репо (`index-state`), тригер
  переопитування.
- **`/repos/:repoId/pulls/:number`** — деталі рев'ю одного PR: огляд, diff,
  список findings з можливістю accept/dismiss, запуск нового прогону
  (`POST /pulls/:id/review`), перегляд активних/минулих прогонів і трейсу.
- **`/repos/:repoId/conventions`** — **Conventions Extractor**: кнопка
  "Extract" (режим `code`-only sampling без LLM-виклику вибору файлів, або
  повний 2-крокий LLM-режим), список кандидатів-конвенцій (`ConventionCard`)
  із категорією, доказом (файл/рядок/сніпет, deep-link на GitHub), станом
  pending/accepted/rejected і inline-редагуванням правила; кнопка
  "Create skill from accepted" відкриває модалку, яка збирає прийняті
  кандидати в Markdown і створює новий skill, одразу лінкуючи його до
  вибраного агента.
- **`/skills`** — сховище скілів: список, створення/редагування/видалення,
  імпорт (`POST /skills/import`).
- **`/agents`** — список агентів (у т.ч. 5 вбудованих, включно з новим
  **API Contract Reviewer**), перемикач enabled/disabled, перехід у
  редактор.
- **`/agents/:id`** — редактор агента з вкладками (`AgentEditor/_components`):
  - **ConfigTab** — назва, опис, провайдер/модель, system prompt,
    strategy, `ci_fail_on`, `repo_intel`-тумблер, enabled.
  - **SkillsTab** — які скіли прив'язані до агента, порядок, увімкнення/
    вимкнення кожного — саме тут вмикається/вимикається контрольний
    "з скілами / без" експеримент для одного й того ж агента.
  - **EvalsTab** — еталонні кейси (diff + очікувані findings), запуск
    прогону агента проти них тим самим пайплайном рев'ю (без repo-intel
    збагачення), порівняння очікуваних/фактичних findings.
  - **StatsTab** — метрики за 30 днів: найчастіше використані скіли,
    findings за важкістю/категорією, історія прогонів з посиланням "View
    trace" на трейс конкретного запуску.
- **`/settings/:section`** — API-ключі провайдерів (OpenAI/Anthropic/
  OpenRouter), вибір моделі за фічею.

### Наскрізний UI

Шапка/навігація/breadcrumbs/шорткати (`g`+клавіша) — `src/components/
app-shell`. Секція навігації "Skills Lab" об'єднує Skills / Agents /
Conventions як пов'язані інструменти побудови й тестування агентів.
