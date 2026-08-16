# Claude Code subagent'и — карта

Субагенти на рівні проєкту (`.claude/agents/*.md`), які викликаються через
інструмент `Agent`. Це Claude Code subagent'и, відмінні від in-app
reviewer-агентів, які засіваються в Postgres через `server/src/db/seed.ts`
(див. [`docs/agent-prompts/`](../../docs/agent-prompts/README.md)) — те саме
слово, але непов'язані системи.

Цей файл — індекс, а не копія: повний текст промпту дивись у відповідному
`.md`-файлі.

## `researcher.md`

- **Відповідальність**: збирає факти з доказами — репозиторне дослідження
  (код, конфіги, документація, git-історія) або зовнішнє дослідження (веб).
  Не вносить змін у код. Спершу ставить уточнювальні питання, якщо запит
  нечіткий.
- **Дозволи**: `model: sonnet`. `tools: Read, Grep, Glob, Bash, WebFetch,
  WebSearch` — без `Write`/`Edit`; проінструктований не обходити це через
  `Bash`.
- **Вхід**: конкретне питання або гіпотеза (якщо запит занадто широкий,
  агент відмовиться шукати й попросить уточнення).
- **Вихід**: лише структурований звіт (`## Findings` / `## Evidence` /
  `## References` / `## Could not determine`), повертається як відповідь
  агента — файли не пишуться.

## `spec-creator.md`

- **Відповідальність**: пише Spec Driven Development специфікації — або
  architectural spec (межі модуля/продукту, контракти, data flow, стек,
  інваріанти; довгоживучий, `docs/specs/<module>/architecture.md` або
  крос-модульний `docs/specs/architecture.md`), або feature spec (одна
  зміна поведінки, EARS acceptance criteria з ідентифікаторами AC-N, edge
  cases, NFR, `docs/specs/<module>/SPEC-NN-<slug>.md`). Аналізує надане
  джерело дизайну (текстовий опис, Figma-опис/скріншот, наявний код, сам
  репозиторій) або, за відсутності, поточну реалізацію — через 6 категорій
  уточнень (Data & loading, Display & sorting, Interactions, State &
  persistence, Feedback, Edge cases) шукає прогалини, непокриті corner
  cases, міжмодульну комунікацію й можливості покращення UX. Блокуюче
  питає лише раз на старті (тип спеки, модуль, джерело дизайну, чи це
  Supersedes); усе інше, що лишається незрозумілим, іде інлайн як
  `[NEEDS CLARIFICATION]` у чернетку. Якщо для висновку треба реальне
  дослідження — не вгадує, а перелічує питання під `## Research needed`
  для паралельного запуску кількох `researcher`-субагентів оркеструючою
  сесією.
- **Дозволи**: `model: sonnet`. `tools: Read, Grep, Glob, Write, Edit,
  Bash, WebSearch, Skill`, `disallowedTools: Bash(git commit:*),
  Bash(git push:*), Bash(git reset:*), Bash(git checkout:*)`. Обмеження
  "лише `docs/specs/**`" — prose-конвенція, як у `doc-writer`/
  `test-writer` (немає `PreToolUse`-хука в цьому репозиторії); ніколи не
  редагує вихідний код чи інші doc-файли (в т.ч. `docs/APP_OVERVIEW.md`).
- **Вхід**: тип спеки, модуль(і), джерело дизайну (якщо є); за
  відсутності — блокуюче питання на старті, далі без повторних блокувань.
- **Вихід**: `.md`-файл під `docs/specs/<module>/` (або крос-модульний
  `docs/specs/architecture.md`) за фіксованим шаблоном свого типу, плюс
  звіт (`## Summary`: тип спеки, шлях, використане джерело дизайну,
  потрібне дослідження, рекомендації, вплив на архітектуру, кількість
  відкритих питань). Traceability-перевірка перед видачею: кожен AC-N
  веде до Goal/User story, кожен Edge case — до AC-N або відкритого
  питання, кожен таск чекліста має AC-N і назву тесту.
- **Джерела правил**: та сама документація Anthropic, що й для
  `implementation-planner.md` (frontmatter, ask-and-relay замість
  вкладеного диспатчу субагентів), EARS (Mavin et al., IEEE RE'09),
  наданий користувачем шаблон feature spec і опис architectural spec.
  Дизайн-документ: [`docs/superpowers/specs/2026-08-11-spec-creator-agent-design.md`](../../docs/superpowers/specs/2026-08-11-spec-creator-agent-design.md).
  **Підключений** до `implementation-planner` (передайте шлях до спеки —
  див. Хендоф нижче); `test-writer` окремо навчений віддавати перевагу
  AC-N зі спеки над характеризацією вже написаного коду.

## `implementation-planner.md`

- **Відповідальність**: перевіряє реквайременти задачі, ставить
  уточнювальні питання там, де щось незрозуміло, і за наявності кращого
  підходу дає власну рекомендацію (простіший дизайн, наявна утиліта
  замість нового коду, менший blast radius) — і лише після цього
  перетворює задачу на структурований Development Plan. Перед
  фіксацією плану завжди перепитує користувача, чи запускати роботу в
  мультиагентному режимі (`implementation-planner` → `implementer` →
  опційно `test-writer` → `plan-verifier`), чи все зробити в single-agent
  проході — відповідь змінює структуру самого файлу плану. Читає
  `INSIGHTS.md` відповідного модуля, `README.md`/`CLAUDE.md`,
  `TESTING.md` та каталог `.claude/skills/`. Ніколи не пише специфікації
  чи acceptance-criteria документи і ніколи не редагує/не виконує
  вихідний код.
- **Дозволи**: `model: sonnet`. `tools: Read, Grep, Glob, Bash, WebSearch,
  Skill`, `permissionMode: plan` — read-only всюди, крім одного план-файлу,
  який дозволено створювати/оновлювати.
- **Вхід**: опис задачі (залучені модулі, визначення "готово") **або**
  шлях до спеки від `spec-creator` (`docs/specs/<module>/SPEC-NN-*.md`) —
  тоді ці два питання вже закриті нею й не перепитуються; за відсутності
  обох спершу ставить уточнювальні питання, а перед записом плану —
  завжди питання про режим виконання (single-agent vs мультиагентний),
  незалежно від того, чи була спека.
- **Вихід**: `.claude/plans/<slug>.md` за структурою Context / Modules
  involved / Constraints / Skills the implementer will use (або "Skills
  to apply" у single-agent режимі) / Ordered steps / Test plan / Out of
  scope, з рядком `**Execution mode:**` одразу під заголовком.
- **Джерела правил**: документація Anthropic про sub-agents і skills
  (конвенції frontmatter, вбудований read-only агент `Plan`, дискавері
  скілів через інструмент `Skill` замість preload, ланцюжки субагентів),
  література з Plan-and-Execute / planner-executor патернів (планувальник
  вирішує "що", не "як"), а також протокол сесії з `CLAUDE.md` цього
  репозиторію (`INSIGHTS.md` перед торканням модуля). Повна таблиця з
  точними цитатами й номерами рядків:
  [`docs/claude-code-agents.md`](../../docs/claude-code-agents.md).

## `implementer.md`

- **Відповідальність**: виконує вже затверджений Development Plan у
  client/server/reviewer-core — редагує код, застосовує скіли, названі в
  плані (а також безумовно `onion-architecture` при зміні
  `server/src/modules/**`, `adapters/**`, `platform/container.ts` або
  `reviewer-core/src/**`), запускає тести за `TESTING.md`, і перевіряє лише
  відповідність плану й результати тестів. Не виконує архітектурне чи
  безпекове рев'ю — це відповідальність окремих агентів.
- **Дозволи**: `model: sonnet`. `tools: Read, Grep, Glob, Edit, Write,
  Bash, Skill`, `disallowedTools: Bash(git commit:*), Bash(git push:*),
  Bash(git reset:*), Bash(git checkout:*)` — повний read/write на код, але
  без можливості комітити, пушити, робити reset чи checkout — це лишається
  за користувачем/сесією.
- **Вхід**: шлях до план-файлу під `.claude/plans/`; за відсутності шляху
  просить його, а не імпровізує обсяг роботи.
- **Вихід**: зміни коду на диску (без коміту) плюс підсумковий звіт
  (`## Summary`: змінені файли, застосовані скіли, запущені тести з
  pass/fail, відхилення від плану, спостереження поза межами відповідальності
  для передачі іншим агентам).
- **Джерела правил**: та сама документація Anthropic, що й для `implementation-planner.md`
  (семантика `disallowedTools`, дискавері скілів на льоту через `Skill`),
  розмежування "перевірки відповідності плану" й "архітектурного/безпекового
  рев'ю" з planner-executor літератури, а також `CLAUDE.md` цього репозиторію
  (список "не чіпати", конвенція wire-контрактів, виклик
  `engineering-insights` наприкінці сесії). Повна таблиця:
  [`docs/claude-code-agents.md`](../../docs/claude-code-agents.md).

## `test-writer.md`

- **Відповідальність**: пише тести для client (React Testing Library +
  Vitest), server (unit/integration) і reviewer-core, застосовуючи
  відповідний скіл і конвенції суту з `TESTING.md` для кожної області.
  Отримавши план/специфікацію або вже наявну фічу, пише тести проти
  *очікуваної* поведінки, а не проти того, що поточний код випадково
  повертає. Торкається лише тестових файлів; ніколи не редагує
  не-тестовий код, щоб змусити тест пройти.
- **Дозволи**: `model: sonnet`. `tools: Read, Grep, Glob, Write, Edit,
  Bash, Skill`, `disallowedTools: Bash(git commit:*), Bash(git push:*),
  Bash(git reset:*), Bash(git checkout:*)`. Обмеження "лише тестові
  файли" — це prose-конвенція, не tool-level lock: `Write`/`Edit` у
  Claude Code не обмежуються path-glob'ом, а `PreToolUse`-хука для цього
  в репозиторії немає, тож агент повинен самоконтролюватися.
- **Вхід**: область (client/server-unit/server-integration/
  reviewer-core/e2e) і режим — characterization (зафіксувати поточну
  поведінку) чи specification/TDD (зафіксувати очікувану поведінку з
  плану); за відсутності будь-якого з цього ставить уточнювальні
  питання.
- **Вихід**: написані тестові файли плюс звіт (`## Summary`: файли,
  область/сут, застосовані скіли, результат запуску тестів, явний
  перелік припущень про очікувану поведінку — щоб людина могла
  перевірити, що агент прийняв за ground truth).
- **Джерела правил**: Michael Feathers (characterization vs.
  specification tests), Martin Fowler "Practical Test Pyramid" (sociable
  vs. solitary unit tests), Kent C. Dodds "Testing Implementation
  Details", `TESTING.md` (суто-конвенції, `*.it.test.ts`), arXiv
  2511.21382 + blog.ploeh.dk 2026-01-26 (tautological LLM-тести),
  code.claude.com/docs/en/sub-agents + tembo.io (відсутність
  path-scoped Write/Edit). Повна таблиця:
  [`docs/claude-code-agents.md`](../../docs/claude-code-agents.md).

## `architecture-reviewer.md`

- **Відповідальність**: read-only архітектурне рев'ю server/
  reviewer-core (і client, за потреби) коду проти вже закодифікованих у
  цьому репозиторії меж — правил скіла `onion-architecture` та шейпу
  модулів з `server/CLAUDE.md`/`client/CLAUDE.md`. Звітує знахідки лише
  з severity + `file:line`-доказом + поясненням, як перевірено; не
  вигадує нових архітектурних правил понад те, що вже закодифіковано.
  Не робить рев'ю якості коду, безпеки чи відповідності плану.
- **Дозволи**: `model: sonnet`. `tools: Read, Grep, Glob, Bash` —
  `Write`/`Edit` фізично відсутні в allowlist (не просто заборонені в
  тексті), як у вбудованих read-only агентах `Explore`/`Plan` і в
  `researcher.md`.
- **Вхід**: ділянка коду для рев'ю (файли, модуль, діапазон diff).
- **Вихід**: лише звіт (`## Findings` зі severity/file:line/verification
  та `## Not architecture (out of scope)`) — файли не пишуться.
- **Джерела правил**: `researcher.md:14-18` та built-in `Explore`/`Plan`
  precedent (read-only, без обходу через `Bash`), `onion-architecture`
  скіл цього репозиторію як rubric, Martin Fowler "fitness functions",
  dependency-cruiser rules-reference (checkable rules, не інференс за
  назвою файлу), code.claude.com/docs/en/code-review (mandatory
  verification, `REVIEW.md` як опційний evidence bar — відсутній у
  цьому репозиторії). Повна таблиця:
  [`docs/claude-code-agents.md`](../../docs/claude-code-agents.md).

## `plan-verifier.md`

- **Відповідальність**: перевіряє готовий код (diff або поточне робоче
  дерево) проти кожного пункту плану/вимог як pass/fail-чекліст — не як
  загальне code-рев'ю. Спершу декомпозує план на пронумерований список
  перевірюваних, конкретних тверджень, потім перевіряє кожне окремо з
  доказом. Явно не коментує стиль, продуктивність, безпеку чи
  архітектуру — такі спостереження йдуть в окрему секцію для передачі
  іншим агентам.
- **Дозволи**: `model: sonnet`. `tools: Read, Grep, Glob, Bash` —
  read-only, без `Write`/`Edit`.
- **Вхід**: шлях до плану/вимог і те, з чим звіряти (diff або поточне
  робоче дерево); за відсутності будь-чого з цього просить уточнення,
  а не вгадує обсяг.
- **Вихід**: лише звіт (`## Requirement checklist` таблиця pass/fail з
  доказами, `## Scope check`, `## Observed, not checked`, `## Could not
  verify`) — файли не пишуться.
- **Джерела правил**: code.claude.com/docs/en/best-practices
  ("adversarial review step" — давати diff і план, не готовий хід
  думок), TICK (arXiv:2410.03608) та Decomposed Criteria-Based
  Evaluation (ACL 2025), Anthropic "Building Effective Agents"
  (evaluator-optimizer, явні критерії), Gherkin/BDD practice
  (acceptance-criteria рев'ю окремо від якості коду). Повна таблиця:
  [`docs/claude-code-agents.md`](../../docs/claude-code-agents.md).

## `doc-writer.md`

- **Відповідальність**: перетворює реалізовану фічу або затверджений
  план на документацію — оновлення README/`docs/`, діаграми (Mermaid) —
  і вирішує, до якого існуючого файлу/індексу в `docs/` контент
  належить, за вже наявною doc-map-конвенцією репозиторію. Перевіряє
  твердження проти реального коду/тестів, а не лише проти тексту плану.
  Обмежений документаційними файлами; ніколи не редагує прикладний код.
- **Дозволи**: `model: sonnet`. `tools: Read, Grep, Glob, Write, Edit,
  Bash, Skill`, `disallowedTools: Bash(git commit:*), Bash(git push:*),
  Bash(git reset:*), Bash(git checkout:*)`. Обмеження "лише
  документаційні файли" — так само prose-конвенція, не tool-level lock
  (немає `PreToolUse`-хука в цьому репозиторії).
- **Вхід**: реалізована фіча або затверджений план, для якого потрібна
  документація.
- **Вихід**: створені/оновлені doc-файли, оновлені індекси (або "не
  потрібно, і чому"), додані діаграми, плюс звіт (`## Summary`) з
  переліком розходжень між планом і реальним кодом, якщо такі знайдено
  (документується завжди реальна поведінка коду).
- **Джерела правил**: dev.to doc-map pattern (читати індекс перед
  записом), sourcegraph.com/blog/documentation-as-code ("false
  freshness"), Diátaxis (diataxis.fr) для класифікації типу документа,
  Google documentation style guide (ієрархія розміщення, "свіжий
  мінімум замість застарілого масиву"), mermaid.js.org (діаграми як
  версійований plain text). Повна таблиця:
  [`docs/claude-code-agents.md`](../../docs/claude-code-agents.md).

## Хендоф

> Усе від `implementer` до `doc-writer` нижче можна запустити одним
> викликом скіла [`sdd-implement`](../skills/sdd-implement/SKILL.md) —
> він автоматизує саме цю секцію (verify/review fix-loop, capped на 3
> раунди). `spec-creator` і `implementation-planner` він не викликає —
> це свідомо лишається ручним кроком.

`spec-creator` тепер **підключений** до `implementation-planner`:
передайте шлях до написаної спеки (`docs/specs/<module>/SPEC-NN-*.md`)
агенту `implementation-planner` — його Step 0 сприймає Goals/Acceptance
criteria зі спеки як відповідь на "який модуль"/"що таке готово" й не
перепитує їх повторно, а Step 1 читає файл спеки як основне джерело
поряд з `CLAUDE.md`/`INSIGHTS.md`. Питання про режим виконання
(single-agent vs мультиагентний, Step 1.5) спека не закриває — це й далі
питається завжди.

- **Мультиагентний**: `implementation-planner` → пише
  `.claude/plans/<slug>.md` → `implementer` читає цей шлях → виконує →
  повертає підсумковий звіт (файл назад не пишеться). Жоден з агентів
  ніколи не робить коміт.
- **Single-agent**: той самий план, але секція скілів і кроки написані так,
  що дослідження, реалізацію й самоперевірку виконує один агент за один
  прохід — без окремого `implementer`.

Розширений ланцюжок рев'ю після реалізації (порядок навмисно змінено —
див. обґрунтування нижче):

`implementer` → **`plan-verifier`** перевіряє готовий код/diff проти
кожного пункту плану як pass/fail-чекліст → якщо PASS: **паралельно**
`test-writer` (пише тести, специфікаційно проти AC-N/кроків плану,
навіть якщо код уже написаний — характеризаційний режим лише коли
жодної спеки/плану немає) і `architecture-reviewer` (архітектурні межі)
→ знахідки поза межами відповідних територій (архітектура/безпека/стиль)
з `plan-verifier`'ного "Observed, not checked" передаються далі:
`architecture-reviewer` для архітектурних меж (**не** для пошуку багів —
це територія скілів `code-review`/`security-review`), `pr-self-review`/
`security` скіли для якості й безпеки. Якщо потрібна документація на
реалізовану фічу — `doc-writer` (незалежно від решти ланцюжка, за
потреби в будь-якій точці після `implementer`). Жоден з агентів ніколи
не робить коміт.

`plan-verifier` іде **перед** `test-writer`/`architecture-reviewer`, а не
після (як було раніше): він найдешевший з трьох (read-only чекліст, без
нових файлів, без прогону тестів) — якщо він знаходить FAIL/PARTIAL,
краще дізнатись про це до того, як витрачені токени на дорожчі кроки.

**Спільний diff-артефакт**: коли оркеструюча сесія в межах однієї задачі
запускає більше одного read-only рев'ювера проти того самого diff'у
(`plan-verifier`, `architecture-reviewer`), вона рахує diff **один раз**
(`git diff` у скретч-файл або явний список файлів) і передає цей
артефакт у промпт кожного рев'ювера, замість "піди й сам подивись diff" —
кожен агент і так перевіряє конкретні твердження читанням реального
файлу, тож дублюється лише сам "що змінилось"-пошук, не сама перевірка.
`plan-verifier`'ний розділ "Observed, not checked" передається як
стартовий список для `architecture-reviewer`, а не остаточна відповідь —
той все одно верифікує кожен пункт власним `file:line`-доказом.
`doc-writer` за замовчуванням довіряє знахідкам з `file:line`-цитатами,
які вже дав read-only рев'ювер у цій самій задачі (вибіркова перевірка
2–3 замість повторної верифікації всього).

**Коли `doc-writer` не потрібен**: якщо весь факт, потрібний для
документації, вже перевірений і присутній у контексті оркеструючої сесії
(наприклад, два рев'ювери щойно відпрацювали і повернули процитовані
знахідки), оркеструюча сесія оновлює документ напряму, а не спавнить
`doc-writer` — агент лишається для випадків, коли потрібне дослідження
коду/тестів понад те, що вже підтверджено в контексті.

*Джерело всього цього розділу: `.claude/plans/agent-orchestration-token-efficiency.md`
(виміряно ~408k токенів на одну фічу середнього розміру; кроки 2, 3, 5
цього плану реалізовано тут 2026-08-11; крок 4 — model-tier trial для
`architecture-reviewer`/`plan-verifier` — досі відкритий, потребує
реального порівняльного прогону, а не припущення).*
