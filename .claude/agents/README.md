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

## `planner.md`

- **Відповідальність**: перетворює задачу на структурований Development
  Plan — читає `INSIGHTS.md` відповідного модуля, `README.md`/`CLAUDE.md`,
  `TESTING.md` та каталог `.claude/skills/`, і зазначає, які скіли
  знадобляться `implementer`-у, щоб план не суперечив правилам реалізації.
  Ніколи не редагує вихідний код.
- **Дозволи**: `model: sonnet`. `tools: Read, Grep, Glob, Bash, WebSearch,
  Skill`, `permissionMode: plan` — read-only всюди, крім одного план-файлу,
  який дозволено створювати/оновлювати.
- **Вхід**: опис задачі (залучені модулі, визначення "готово"); за
  відсутності цього спершу ставить уточнювальні питання.
- **Вихід**: `.claude/plans/<slug>.md` за структурою Context / Modules
  involved / Constraints / Skills the implementer will use / Ordered steps /
  Test plan / Out of scope.
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
- **Джерела правил**: та сама документація Anthropic, що й для `planner.md`
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

`planner` → пише `.claude/plans/<slug>.md` → `implementer` читає цей шлях →
виконує → повертає підсумковий звіт (файл назад не пишеться). Жоден з
агентів ніколи не робить коміт.

Розширений ланцюжок рев'ю після реалізації:

`implementer` → якщо план вимагає нових тестів — `test-writer` пише їх
(читаючи той самий план-файл) → `plan-verifier` перевіряє готовий
код/diff проти кожного пункту плану як pass/fail-чекліст → знахідки поза
межами "відповідність плану" (архітектура/безпека/стиль) з
`plan-verifier`'ного "Observed, not checked" передаються далі:
`architecture-reviewer` для архітектурних меж, `pr-self-review`/`security`
скіли для якості й безпеки. Якщо потрібна документація на реалізовану
фічу — `doc-writer` (незалежно від решти ланцюжка, за потреби в будь-якій
точці після `implementer`). Жоден з нових чотирьох агентів ніколи не
робить коміт.
