# Spec: Export to CI — серіалізація агента в GitHub Actions review
Spec ID: SPEC-08
Status: approved
Supersedes: жодного попереднього `SPEC-NN` не замінює. Це перша спека, що
матеріалізує `ci/`-модуль студії — раніше порожній/невикористаний шар
(`ci_installations`/`ci_runs` в БД, контракти `eval-ci.ts`) — і замикає його
на вже готовий, окремо протестований `agent-runner/` (гілка `homework-08`,
ще не в `main`).

## Проблема й користувач

**Реконсиляція з вихідними даними задачі (читати перед AC).** Дослідницька
сесія виявила, що значно БІЛЬШЕ з описаної в лабораторній інфраструктури
вже існує, ніж стверджує сам worktree-опис завдання — і водночас кілька
конкретних деталей мокапу технічно не витримують зіставлення з реальним,
уже написаним `agent-runner/`. Обидва напрямки змінюють обсяг задачі.

**(1) Контракти майже повністю вже написані — новий файл контрактів НЕ
потрібен.** `server/src/vendor/shared/contracts/eval-ci.ts:175-292` вже має
секцію "Export-to-CI + CI Runs" з `CiTarget`, `CiFile`, `AgentManifest`
(+`AgentManifestInput`), `CiExportInput` (+`CiExportInputBody`),
`CiInstallation`, `CiExport`, `CiRunStatus`, `CiRun`, `CiResultArtifact`.
Ця спека РОЗШИРЮЄ ці Zod-схеми на місці (нові поля), не заводить нового
файлу — назва файлу ("eval-ci") стосується і L06 evals, і CI одночасно,
історично, не помилково.

**(2) Підтверджено серйозний dual-copy розрив (той самий клас, що вже
задокументований `INSIGHTS.md` 2026-07-31/2026-08-20): клієнтська копія
`eval-ci.ts` не має `AgentManifest`/`AgentManifestInput` ВЗАГАЛІ.**
Порівняння `server/src/vendor/shared/contracts/eval-ci.ts:190-217` з
`client/src/vendor/shared/contracts/eval-ci.ts:182-190` показує: сервер має
блок `AgentManifest` між `CiFile` і `CiExportInput`, клієнт — ні, файл
стрибає прямо з `CiFile` на `CiExportInput`. Якщо Preview-крок візарда мусить
показати/відрендерити валідний YAML manifest на клієнті, ця схема потрібна і
там — тож ця спека **зобов'язана** портувати блок, а не лише додавати нові
поля до вже спільних типів.

**(3) `ci_installations`/`ci_runs` в БД існують, але не мають потрібних
колонок — і `ci/`-модуль сервера відсутній повністю.** `server/src/db/schema/ci.ts:4-26`
підтверджує обидві таблиці змигровані (schema.ts реекспортує їх), але
`server/src/modules/ci/` фізично не існує (`Glob` на
`server/src/modules/ci/**` — 0 файлів), попри те, що `agent-runner`'s власна
документація вже ПОКЛАДАЄТЬСЯ на нього як на існуючий: `agent-runner/src/manifest.ts:9`'s
doc-comment каже "written by the studio's export flow
(`server/src/modules/ci/manifest.ts`)", `agent-runner/CLAUDE.md`'s "Read
When" секція каже "owned by the server `ci` module, not this package", і
`agent-runner/insights/INSIGHTS.md:38` цитує
"`server/src/modules/ci/workflow.ts`" як майбутнє джерело `POST_AS`-подібної
env-змінної. Тобто `agent-runner` написаний З ОЧІКУВАННЯМ конкретних
серверних файлів за конкретними шляхами — ця спека реалізує саме їх, а не
довільну структуру.

Крім модуля, сама схема `ci_runs` НЕ покриває все, що вимагає лабораторна й
контракт `CiRun`: немає колонки `agent`/`duration_s` (є лише в Zod-контракті,
`server/src/vendor/shared/contracts/eval-ci.ts:254-268`, не в
`server/src/db/schema/ci.ts:14-26` — `agent` резолвиться через join на
`ci_installations.agentId → agents.name`, а `duration_s` не має відповідника
в БД взагалі), немає розбивки по severity (critical/warning/suggestion —
є в `CiResultArtifact`, немає в `ci_runs`), і немає `commit_sha` взагалі —
попри пряму вимогу лабораторної "у trace зберігаємо ... commit SHA". Нова
migration потрібна (T-задачі нижче).

**(4) Ні `agents`, ні `skills` не мають колонки `slug`.**
`server/src/db/schema/agents.ts:8-36` і `server/src/db/schema/skills.ts:5-21`
підтверджено прочитані повністю — жодного `slug`. Файлові імена
`.devdigest/agents/<slug>.yaml`/`.devdigest/skills/<slug>.md` обчислюються
"на льоту" (slugify з `name`, дедуплікація суфіксом при колізії в межах
одного експорту), НІКОЛИ не персистуються як нова колонка — той самий
принцип "мінімальний персистований стан", що вже прийнятий SPEC-07 для
кластеризації знахідок.

**(5) `agents.ciFailOn` вже існує й редагується в Config tab — CI tab НЕ
заводить другий незалежний контрол.** `server/src/db/schema/agents.ts:25-27`
(`ciFailOn`, вже персистована колонка), і клієнт вже має робочий UI для неї
(`grep` на `ciFailOn` знаходить `ConfigTab.tsx` серед 9 файлів). "Fail CI
on" у мокапі CI tab — це READ-ONLY відображення того самого значення (з
лінком/кнопкою "Edit in Config"), не нова форма — уникає проблеми
"два джерела правди для одного поля", яку довелось би вирішувати інакше.

**(6) `GitHubClient.commitFiles`/`openPullRequest`/`findOpenPr` вже повністю
реалізовані (реальний адаптер + мок), але ще НЕМАЄ жодного споживача.**
`server/src/vendor/shared/adapters.ts:155-163` (інтерфейс),
`server/src/adapters/github/octokit.ts:245,264,332` (реальна реалізація),
`server/src/adapters/mocks.ts:218-230` (мок) — усі три методи вже приймають
рівно ту форму (`CommitFilesPayload` з `branch`/`base`/`files`,
`OpenPrPayload`), що потрібна кроку Install "Open a PR with these files" на
гілку `devdigest/ci`. Це готовий примітив, не новий адаптерний метод — Т-
задача підключає, не пише GitHub API-код з нуля.

**(7) Немає жодної інфраструктури автентифікованих вхідних запитів (API-
ключ/HMAC/Bearer) в усьому сервері — і сам сервер локальний, не публічно
досяжний.** `Glob` на `server/src/adapters/auth/*` дає лише
`local.ts` (`LocalNoAuthProvider` — єдиний засіяний користувач+workspace,
жодної реальної автентифікації), `Grep` на `apiKey|Bearer|HMAC|webhook.*secret|signature`
по всьому серверу не дав жодного релевантного збігу поза LLM-адаптерами.
"Push"-модель (GitHub Actions job шле `POST` на студію) вимагала б (а) нового
типу секрету, якого немає в жодному мокапі Configure-кроку (там лише
`OPENAI_API_KEY`→`OPENROUTER_API_KEY` і `GITHUB_TOKEN`, РІВНО два рядки,
підтверджено користувачем), і (б) публічної досяжності локального сервера з
GitHub-раннера — суперечність із задокументованою "no keys required to
boot"/локальною природою застосунку (`server/README.md:23-29`). Натомість
**doc-comment самого контракту вже підказує правильну модель**:
`CiResultArtifact`'s коментар (`eval-ci.ts:270-273`) буквально каже
"Ingested back on refresh to populate `ci_runs` (L06)" — "on refresh", не
"on push". Мокап CI Runs (N13) підтверджує це UI-кнопкою "Refresh" і
перемикачем "auto-refresh on". **Рішення цієї спеки: PULL-модель.** Студія
(вже маючи власний, довгоживучий `GITHUB_TOKEN`, той самий, що вже
використовується для diff/PR-фетчу й тепер для Install-кроку) періодично/за
натиском "Refresh" опитує GitHub Actions API за встановленими інсталяціями,
знаходить прогони workflow-файлу `devdigest-review.yml`, і завантажує
артефакт `devdigest-result.json` (новий крок генерованого workflow:
`actions/upload-artifact`). Це не вимагає жодного нового секрету в
репозиторії цілі, не вимагає публічної досяжності студії, і "автентифікований
… канал" з лабораторної виконується тим, що ЗАПИТ ініціює сама студія своїм
уже довіреним токеном (не анонімний вхідний POST). Залишковий ризик
(підроблений артефакт від fork-PR прогону) — див. NFR.

**(8) `agent-runner` вже написаний і протестований (19/19), але буквально
НЕ несе `commit_sha`/`model` у своєму артефакті — реальний, підтверджений
розрив із вимогою лабораторної.** `agent-runner/src/context.ts:22-33`'s
`PrContext` не має жодного SHA-поля (лише owner/repo/prNumber/title/body/
isFork); `agent-runner/src/artifact.ts:8-14,32-44`'s
`BuildResultArtifactInput`/`buildResultArtifact` будує `CiResultArtifact` з
`findings`/`costUsd`/`durationMs`/`agent`(лише ім'я)/`prNumber` — без
`commit_sha`, без `model`. Лабораторна прямо вимагає "у trace зберігаємо
версію manifest, модель, залежності, і commit SHA" — цей код цього не
робить. Ця спека **зобов'язана торкнутись уже зданого `agent-runner/`**
(не лише `ci/`), додавши поле в `PrContext`/`CiResultArtifact`/
`buildResultArtifact` — торкається файлу, який власний `agent-runner/CLAUDE.md`
позначає як "Do Not Touch Without Reading" (не "ніколи не чіпай" — сама
CLAUDE.md передбачає майбутні зміни: "If a future change to `reviewer-core`
would require... that is a signal the change belongs in a spec/plan
discussion" — це саме той сигнал).

**(9) Мокап показує `secrets.OPENAI_API_KEY`/`openai-key`, реальний
`agent-runner` читає `OPENROUTER_API_KEY` напряму з `process.env`
(`agent-runner/README.md:91`, `agent-runner/CLAUDE.md:35-50`'s секція "Why
This Package Intentionally Breaks the `SecretsProvider` Rule").** Рішення —
на користь реального коду: генерований workflow і Configure-крок
використовують `OPENROUTER_API_KEY`, ніде `OPENAI_API_KEY`. Секція
`agent-runner/CLAUDE.md` пояснює ЧОМУ це навмисний, а не помилковий виняток
із правила root `CLAUDE.md`/`server/CLAUDE.md` про `LocalSecretsProvider` як
єдиний легітимний читач `process.env`: `agent-runner` виконується в CI
**ІНШОГО** репозиторію, де немає ані `Container`, ані `SecretsProvider`, ані
DI-графа — єдиний канал передачі секрету туди — змінна оточення, яку сама
workflow-yaml підставляє з `secrets.*`. Правило `server/CLAUDE.md` явно
скоуплене на `server/` і не поширюється сюди; це не порушення дисципліни
секретів, а інша довірча межа. Ця спека не змінює цей факт, лише
генерує workflow, що коректно з ним узгоджується.

**(10) Мокап Preview показує `.devdigest/memory.jsonl` як один із 5 файлів
— цієї функціональності не існує в кодовій базі взагалі.** `Grep` на
`memory\.jsonl|agent_memory|AgentMemory` по всьому серверу і `Glob` на
`client/src/app/memory/**` — обидва 0 результатів. `server/README.md:9-14`
прямо каже: "memory" — один зі слотів МАЙБУТНЬОГО уроку, поки не наповнений.
Експортувати файл без джерела даних — вигадати дані. Рішення: ця спека
пише **порожній** `.devdigest/memory.jsonl` (валідний, порожній JSONL-файл,
0 рядків) до появи реального Memory-модуля — Preview показує його як
"(empty — no memory recorded yet)", не приховує зі списку (мокап його
показує), але не вигадує вміст.

**(11) Мокап Preview НЕ показує 6-й файл, який реально потрібен: збандлений
`.devdigest/runner/index.js`.** `agent-runner/README.md:7-9` прямо каже
runner "is embedded as `.devdigest/runner/index.js` in the exported
`devdigest/ci` PR" — без нього workflow-крок `node .devdigest/runner/index.js`
не має що виконувати. Мокап (за словами користувача, N12 секція) показує
рівно 5 файлів — цей файл додається понад мокап, з примітками "generated,
not human-editable" (`CiFile.editable: false` — на відміну від
yaml/md/jsonl, які `editable: true`).

**(12) `uses: devdigest/review-action@v1` з мокапу — буквальний
плейсхолдер, не мета генерації.** Підтверджено буквально текстом задачі:
такого опублікованого action не існує. Реальний генерований workflow
запускає `node .devdigest/runner/index.js` напряму (checkout + сам
збандлений раннер із кроку 11), без будь-якого `uses: devdigest/...`.

**Проблема.** Агент, налагоджений локально в студії, сьогодні ніяк не може
захищати PR-и цільового репозиторію автоматично — рев'ю лишається ручним
кліком у студії. Немає способу перенести конфігурацію агента (модель,
system prompt, скіли, gate-політику) у чужий репозиторій як версіоновану,
відтворювану артефакт, і немає способу побачити результати таких прогонів
поруч із локальними в студії.

**Користувач.** Той самий власник агента (security-reviewer/perf-reviewer
з попередніх уроків), який після кількох вдалих локальних прогонів хоче
"поставити агента на PR-конвеєр" цільового репозиторію без ручного
втручання — відкриває Export Wizard, обирає GitHub Actions, переглядає, що
буде згенеровано, підтверджує тригери й спосіб публікації, і або відкриває
PR з файлами, або завантажує їх як zip для ручного встановлення.

## Goals / Non-goals

**Goals**

- **G1 — Точка входу: "Add to CI" на вкладці CI сторінки агента.** Нова
  вкладка `ci` в `AgentEditor`'s `TABS` (`constants.ts:11-18` вже має
  коментар "Later lessons add CI" — цей слот). Кнопка тексту залежить від
  того, чи вже є хоч одна `ci_installations` для цього агента:
  "Add to CI" (немає) / "Update CI config" (є) — той самий принцип, що вже
  показаний у мокапі.
- **G2 — Export Wizard, 4 кроки: Target → Preview → Configure → Install.**
  `ExportWizardSteps` (`client/src/vendor/ui/ExportWizardSteps.tsx`) —
  вже готовий, невикористаний компонент степера саме такої форми
  (`step`+`labels`) — перевикористовується як є.
- **G3 — Target: GitHub Actions єдина активна ціль.** CircleCI/Jenkins/
  Generic CLI показуються (мокап явно показує всі 4 картки), але
  disabled/недоступні для вибору — жодного генератора для них не існує й не
  пишеться цією спекою (буквальна вимога завдання: "показати лише якщо
  генератори реалізовані").
- **G4 — Preview: реальний, редагований набір файлів.** 6 файлів (5 з
  мокапу + збандлений раннер, п.11 Реконсиляції):
  `.devdigest/agents/<slug>.yaml`, `.devdigest/skills/<slug>.md` (по одному
  на кожен enabled+linked скіл агента), `.devdigest/memory.jsonl` (порожній,
  п.10), `.github/workflows/devdigest-review.yml`, `.devdigest/runner/index.js`
  (не редагований). Контент кожного файлу обчислюється серверною чистою
  функцією з поточної конфігурації агента — без побічних ефектів на цьому
  кроці (нічого не пишеться в БД чи GitHub, доки Install).
- **G5 — Configure: тригери + спосіб публікації + (disabled) Block merge.**
  Чекбокси `opened`(default on)/`synchronize`(default on)/`reopened`(default
  off); radio "Post results as": `github_review`(default)/`pr_comment`/
  `none`; перемикач "Block merge on findings" — рендериться, завжди
  `disabled`, з підписом "Requires a GitHub App — not available with PAT in
  local mode" (буквально з мокапу — не бракує функціоналу, це навмисне
  документування межі поточного auth-режиму, `LocalNoAuthProvider`/PAT-based
  GitHub adapter, без GitHub App).
- **G6 — Install: Open a PR / zip.** "Open a PR with these files"
  (рекомендовано, default) — комітить усі 6 файлів на нову гілку
  `devdigest/ci` (не в `main`/`base` напряму) і відкриває/перевикористовує PR
  (`GitHubClient.commitFiles`+`openPullRequest`/`findOpenPr`, готові, п.6
  Реконсиляції). "Copy files as a zip" — повертає ті самі 6 файлів як
  zip-архів, без жодного GitHub-виклику.
- **G7 — Розширення контракту `AgentManifest`/`CiResultArtifact` (обидві
  копії `vendor/shared`).** `AgentManifest` синхронізується з клієнтом
  (п.2 Реконсиляції — портується блок, що зараз існує лише на сервері).
  `CiResultArtifact` отримує нові поля `commit_sha`/`model`/`agent_version`
  (п.3, п.8 Реконсиляції) — необхідні для trace-вимоги лабораторної.
- **G8 — Нова migration на `ci_runs`/`ci_installations`.** `commit_sha`,
  `model`, `agent_version`, `duration_s`, `critical`/`warning`/`suggestion`
  на `ci_runs`; `workflow_version` на `ci_installations` (для вкладки CI —
  "версія workflow"). Ніколи рукописна — `pnpm db:generate`.
- **G9 — PULL-модель ingest (не push-endpoint) — рішення Реконсиляції п.7.**
  Студія опитує GitHub Actions API (новий метод `GitHubClient`) за кожною
  `ci_installations`, шукає прогони `devdigest-review.yml`, завантажує
  `devdigest-result.json`-артефакт (новий крок генерованого workflow), і
  upsert'ить `ci_runs` + пише `agent_runs`(source='ci') — той самий
  подвійний запис, що дозволяє CI Runs-таблиці (свій шейп) і потенційному
  майбутньому trace-перегляду (через `agent_runs`) співіснувати.
- **G10 — CI Runs — нова глобальна сторінка.** Таблиця з фільтрами (7 днів/
  агент/репо/статус/джерело), колонками TIMESTAMP/PULL REQUEST/AGENT/SOURCE/
  DUR./FINDINGS(за severity)/COST/STATUS, і "Trace" на кожен рядок —
  **вирішено (не internal `RunTraceDrawer`)**: посилання відкриває
  `ci_runs.github_url` (зовнішній лінк на сам GitHub Actions job) у новій
  вкладці — `CiResultArtifact` навмисно не несе prompt/tool-calls/findings-
  масив (лише агреговані метрики), тож внутрішній дровер не мав би що
  показати (див. NFR).
- **G11 — Вкладка CI сторінки агента.** Кнопка Add-to-CI/Update-CI-config,
  список інсталяцій (repo, target, коли встановлено, версія workflow),
  READ-ONLY "Fail CI on: {ci_fail_on}" з лінком на Config tab (п.5
  Реконсиляції), і історія останніх CI-прогонів цього агента (той самий
  `ci_runs`-шейп, звужений до `agent_id`).

**Non-goals**

- **`server/src/modules/ci/**` НЕ чіпає сервіс мультипрогонів (SPEC-07) чи
  PR-стрічку** — буквальна межа задачі; жодний файл `reviews/`,
  `multi_agent_runs` не редагується цією спекою.
- **Settings → Integrations (мокап N9, "Install in a repo" на рівні
  workspace).** Секція не існує в коді (`SettingsView/constants.ts:5-6` має
  лише `api-keys`/`models`) і НЕ входить у явно заявлений обсяг worktree B
  ("ci/, його роути, CI Runs і вкладка CI агента") — залишена
  повністю нерозв'язаною (Open questions), не додається цією спекою.
- **CircleCI/Jenkins/Generic CLI генератори.** Картки показуються
  (disabled) в Target-кроці, жодного реального генератора коду для них.
- **GitHub App / справжнє branch-protection-enforced "Block merge".**
  Перемикач рендериться disabled — вимагає авторизаційної моделі, якої
  застосунок не має (лише PAT через `LocalNoAuthProvider`-подібний,
  однокористувацький режим).
- **Memory-модуль.** `.devdigest/memory.jsonl` пишеться порожнім — ця
  спека не реалізує саму пам'ять агента (окремий майбутній урок).
- **Push-модель ingest / публічно досяжний ingest-endpoint.** Рішення —
  PULL через GitHub Actions API (G9); жодного нового секрету/токена в
  генерованому workflow для зв'язку "назад" до студії.
- **Внутрішній `RunTraceDrawer` для CI-прогонів.** "Trace" веде на
  зовнішній GitHub job URL (G10) — не форк, не спрощена версія дровера.

## User stories

- Як власник агента, я відкриваю сторінку агента, переходжу на вкладку CI,
  бачу кнопку "Add to CI" (агент ще не експортований), тисну її.
- Як той самий власник, я обираю GitHub Actions (єдина активна картка),
  бачу список файлів, що будуть створені, відкриваю `devdigest-review.yml` і
  редагую тригери прямо в редакторі попереднього перегляду.
- Як той самий власник, на кроці Configure я лишаю `opened`+`synchronize`
  позначеними, `reopened` — ні, обираю "GitHub review" як спосіб публікації,
  бачу що "Block merge on findings" недоступний із поясненням чому.
- Як той самий власник, на Install я тисну "Install" з обраним "Open a PR"
  — бачу лінк на новий PR у `owner/repo`, гілка `devdigest/ci`.
- Як той самий власник, я мерджу PR (вручну, поза студією), додаю
  `OPENROUTER_API_KEY` в Settings → Secrets цільового репо (вручну, поза
  студією), відкриваю тестовий PR — GitHub Actions прогонює рев'ю.
- Як той самий власник, я повертаюсь на CI Runs (глобальна сторінка), тисну
  "Refresh" — бачу новий рядок з таймстампом/PR/агентом/severity-лічильниками
  /вартістю/статусом, тисну "Trace" — відкривається GitHub Actions job у
  новій вкладці.
- Як той самий власник, я повертаюсь на вкладку CI агента — бачу оновлену
  історію прогонів цього агента й "Fail CI on: CRITICAL" (лінк на Config).

## Acceptance criteria (EARS)

**Контракти + БД (G7, G8)**

- **AC-1** (ubiquitous). `client/src/vendor/shared/contracts/eval-ci.ts`
  (shall) отримати блок `AgentManifest`/`AgentManifestInput`, портований
  1:1 із серверної копії (`server/.../eval-ci.ts:190-217`) — дублювання, не
  перейменування; обидві копії лишаються Zod-ідентичними для цього блоку.
- **AC-2** (ubiquitous). `CiResultArtifact` (обидві копії) (shall) отримати
  нові поля: `commit_sha: z.string().min(1)`, `model: z.string()`,
  `agent_version: z.number().int().nullish()` — існуючі поля
  (`findings_count`/`critical`/`warning`/`suggestion`/`cost_usd`/
  `duration_ms`/`agent`/`version`/`pr_number`) лишаються без змін.
- **AC-3** (ubiquitous). Нова migration (`pnpm db:generate`, ніколи
  рукописна) (shall) додати на `ci_runs`: `commit_sha` (text, nullable),
  `model` (text, nullable), `agent_version` (integer, nullable),
  `duration_s` (double precision, nullable), `critical`/`warning`/
  `suggestion` (integer, nullable кожен) — і на `ci_installations`:
  `workflow_version` (text, nullable, семантична версія генератора
  workflow, не версія самого GitHub Actions runtime).
- **AC-4** (ubiquitous). `ci_installations` (shall) отримати нову
  `uniqueIndex` на `(agent_id, repo, target_type)` — повторний "Update CI
  config" для того самого агента/репо/цілі (shall) оновити існуючий рядок
  (upsert), не створювати дублікат.

**Target (G3)**

- **AC-5** (ubiquitous). Крок Target (shall) показати 4 картки (GitHub
  Actions, CircleCI, Jenkins, Generic CLI); лише GitHub Actions (shall)
  бути клікабельною/вибраною за замовчуванням — решта три (shall) мати
  візуальний disabled-стан і НЕ приймати клік (жодного генератора немає —
  Non-goals).
- **AC-6** (unwanted behavior). ЯКЩО клієнт все ж надішле
  `target !== 'gha'` у `CiExportInput` на будь-якому кроці Preview/
  Configure/Install, ТО сервер (shall) відповісти 400
  `unsupported_ci_target` — той самий "не приховувати ціну" принцип, що вже
  застосований SPEC-07 до `learn`/`reply` дій.

**Preview (G4)**

- **AC-7** (ubiquitous). `POST /agents/:id/export-ci` з `action: 'files'`
  (shall) повернути рівно 6 `CiFile` записів (список файлів з G4), кожен з
  `editable: true`, ОКРІМ `.devdigest/runner/index.js`, який (shall) мати
  `editable: false`.
- **AC-8** (ubiquitous). `.devdigest/agents/<slug>.yaml`'s вміст (shall)
  бути YAML-серіалізацією `AgentManifest`, побудованого з поточного
  `agents`-рядка (`name`, `provider`, `model`, `systemPrompt`, `strategy`,
  `ciFailOn` → `ci_fail_on`) + `skills` як масив slug'ів enabled+linked
  скілів — і (shall) успішно проходити `AgentManifest.safeParse` після
  парсингу YAML назад (round-trip), тим самим Zod-контрактом, який
  `agent-runner/src/manifest.ts:69` вже застосовує на прийомі.
- **AC-9** (ubiquitous). `<slug>` для агента й кожного скіла (shall)
  обчислюватись "на льоту" (kebab-case з `name`, дедуплікація суфіксом
  `-2`/`-3`… при колізії в межах ОДНОГО експорту) — ніколи не персистуватись
  як нова колонка (Реконсиляція п.4).
- **AC-10** (ubiquitous). `.devdigest/memory.jsonl` (shall) бути порожнім
  валідним файлом (0 рядків) — Preview (shall) показати підпис "(empty — no
  memory recorded yet)" замість вмісту редактора для цього файлу
  (Реконсиляція п.10; Memory-модуль — Non-goal).
- **AC-11** (ubiquitous). `.github/workflows/devdigest-review.yml`'s
  згенерований вміст (shall): (а) використовувати
  `env.OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`, НІКОЛИ
  `OPENAI_API_KEY`/`openai-key` (Реконсиляція п.9); (б) НЕ містити
  `uses: devdigest/review-action@v1` — крок запуску (shall) бути
  `run: node .devdigest/runner/index.js` (Реконсиляція п.12); (в) містити
  явний `permissions:` блок з РІВНО `contents: read` і
  `pull-requests: write` (типово; `write` лише коли `post_as !== 'none'`) —
  усе не перелічене лишається на GitHub-дефолті `none`; (г) пінити
  `actions/checkout` і `actions/upload-artifact` до повного commit SHA, не
  плаваючого тега (`@v4`) — той самий принцип "зовнішні actions — фіксувати
  SHA", буквально з лабораторної, застосований до реально зовнішніх
  actions цього workflow (не до самого раннера, який лежить у репозиторії).
- **AC-12** (ubiquitous). Редактор Preview (shall) дозволяти редагування
  вибраного файлу inline (для 5 `editable: true` файлів) — правки (shall)
  зберігатись лише в стані візарда (не персистуються, доки Install), і
  (shall) бути тим самим вмістом, що піде в Install-крок.

**Configure (G5)**

- **AC-13** (ubiquitous). Чекбокси тригерів (shall) мати дефолт
  `opened: true`, `synchronize: true`, `reopened: false` — незалежно від
  `.default()`-значення самого `CiExportInput.triggers` у контракті (яке
  лишається `['opened','synchronize','reopened']` для викликачів поза
  візардом) — клієнт завжди явно надсилає обраний масив.
- **AC-14** (unwanted behavior). ЯКЩО усі три чекбокси тригерів вимкнено, ТО
  кнопка переходу на Install (shall) бути disabled — воркфлоу без жодного
  `on.pull_request.types` тригера ніколи не виконається, показувати його як
  валідний результат — вводити в оману.
- **AC-15** (ubiquitous). Radio "Post results as" (shall) мати дефолт
  `github_review`, з бейджем "recommended" — відповідає `post_as`-полю
  `CiExportInput`.
- **AC-16** (ubiquitous). Перемикач "Block merge on findings" (shall)
  рендеритись завжди `disabled=true` з підписом "Requires a GitHub App —
  not available with PAT in local mode" — жодного шляху увімкнути його в
  цій версії застосунку (Non-goals).
- **AC-17** (ubiquitous). Секція "Secrets expected" (shall) показати РІВНО
  два рядки: `OPENROUTER_API_KEY` ("Your OpenRouter key", бейдж "not set"
  якщо не сконфігуровано в `~/.devdigest/secrets.json`/`process.env` на
  СТУДІЇ — це не про репо-секрет цілі, а про те, чи студія взагалі має чим
  прогнати демонстраційний перший локальний тест) і `GITHUB_TOKEN`
  ("Auto-provided by Actions", бейдж "ready") — жодного третього рядка
  (жодного ingest-токена/секрету — G9's PULL-модель).

**Install (G6)**

- **AC-18** (ubiquitous). "Open a PR with these files" (shall) бути
  вибраним за замовчуванням, з описом, що містить `<repo>` і назву PR
  "Add DevDigest CI review".
- **AC-19** (event-driven). КОЛИ користувач тисне "Install" з обраним
  "Open a PR", сервер (shall): (а) закомітити всі 6 файлів на гілку
  `devdigest/ci` через `GitHubClient.commitFiles` (створює гілку з `base`,
  якщо відсутня; форвардить, якщо існує); (б) знайти вже відкритий PR з цієї
  гілки через `findOpenPr`, і якщо є — повернути його, інакше відкрити новий
  через `openPullRequest`; (в) upsert-нути рядок `ci_installations` (AC-4);
  (г) повернути `CiExport{installation, files, pr_url}`.
- **AC-20** (event-driven). КОЛИ користувач тисне "Install" з обраним
  "Copy files as a zip", сервер (shall) повернути ті самі 6 файлів як
  zip-архів (`action: 'files'`-шлях контракту) — жодного GitHub-виклику,
  жодного запису `ci_installations` (інсталяція реєструється лише коли
  файли реально десь опубліковані/встановлені руками; локальний "просто
  подивитись" сценарій не створює фантомну інсталяцію).
- **AC-21** (unwanted behavior). ЯКЩО `GitHubClient.commitFiles`/
  `openPullRequest` кидає (репо не знайдено, немає прав, мережева
  помилка), ТО ендпоінт (shall) повернути помилку ДО запису
  `ci_installations` — жодної "напівінсталяції" без реального PR/файлів.

**Ingest — PULL-модель (G9)**

- **AC-22** (ubiquitous). Новий метод `GitHubClient.listWorkflowRunsFor(repo,
  workflowFile)` (shall) повернути прогони workflow-файлу
  `devdigest-review.yml` (найновіші перші) з `run_id`/`head_sha`/`status`/
  `html_url` — новий метод інтерфейсу `adapters.ts` + реалізація в
  `octokit.ts` + мок у `mocks.ts` (той самий трискладовий патерн, що вже є
  для `commitFiles`/`openPullRequest`).
- **AC-23** (ubiquitous). Новий метод `GitHubClient.downloadRunArtifact(repo,
  runId, artifactName)` (shall) повернути розпарсений JSON артефакту
  `devdigest-result.json`, або `null`, якщо такого артефакту в прогоні нема
  (best-effort — прогон міг завалитись до кроку upload).
- **AC-24** (event-driven). КОЛИ користувач тисне "Refresh" на CI Runs
  (чи авто-refresh спрацьовує), сервер (shall) для кожної
  `ci_installations`-інсталяції: перелічити нові прогони (AC-22) новіші за
  останній `ran_at` уже персистованого `ci_runs`, завантажити артефакт
  (AC-23), Zod-провалідувати як `CiResultArtifact` (AC-2), і за успіху —
  upsert `ci_runs`-рядок (`ci_installation_id`, `pr_number`, `ran_at`,
  `status`, розбивка severity, `cost_usd`, `duration_s`, `github_url`,
  `source: 'GitHub Actions'`, `commit_sha`, `model`, `agent_version`) ТА
  вставити відповідний `agent_runs`-рядок (`source: 'ci'`, `workspaceId` з
  `ci_installations.agentId → agents.workspaceId`, `prId: null` — цільовий
  репозиторій типово не онбордений у `pull_requests`).
- **AC-25** (unwanted behavior). ЯКЩО артефакт не проходить
  `CiResultArtifact.safeParse`, ТО прогон (shall) бути пропущений (лог
  warning, жодного запису `ci_runs`/`agent_runs`) — той самий "hard failure
  вище рівня grounded review дає НІЧОГО, не синтетичний рядок" принцип, що
  вже прийнятий `agent-runner`'s власним контрактом (`README.md:108-112`).
- **AC-26** (unwanted behavior). ЯКЩО артефакт валідний, але `commit_sha`
  не збігається з `head_sha` прогону, отриманим від GitHub API (AC-22) —
  а не лише з тим, що написано всередині самого JSON, ТО прогон (shall)
  бути пропущений з тим самим "no synthetic row" наслідком — захист від
  підробленого/застарілого артефакту (NFR нижче).

**CI Runs (G10)**

- **AC-27** (ubiquitous). Нова сторінка `/ci-runs` (shall) додатись до
  `GLOBAL`-секції лівого нав, поруч із "Multi-Agent Review"/"Agent
  Performance"/"Memory" — `activeKeyFor` (`app-shell/helpers.ts:42`) вже має
  гілку `ci-runs`, чекає лише на реальний роут/сторінку.
- **AC-28** (ubiquitous). Таблиця (shall) мати колонки TIMESTAMP/PULL
  REQUEST(`#num`+title)/AGENT/SOURCE(бейдж "GitHub Actions")/DUR./FINDINGS
  (кольорові лічильники critical/warning/suggestion, чи "—" якщо
  `findings_count === 0`)/COST/STATUS(Succeeded/No findings/Failed)/Trace
  (лінк) — джерело даних: `GET /ci/runs`, workspace-scoped, з фільтрами
  `since`/`agent_id`/`repo`/`status`/`source`. Рядок з
  `ci_installation_id: null` (агента чи інсталяцію видалено) (shall)
  лишатись видимим з AGENT-фолбеком "Agent" замість назви — не зникати з
  таблиці й не кидати помилку рендеру.
- **AC-29** (event-driven). КОЛИ користувач клікає "Trace" на будь-якому
  рядку, система (shall) відкрити `ci_runs.github_url` у новій вкладці
  (`target="_blank"`, `rel="noopener"`) — НЕ внутрішній `RunTraceDrawer`
  (G10, обґрунтування в NFR).
- **AC-30** (ubiquitous). Фільтр "All repos" (shall) будуватись з
  DISTINCT `ci_installations.repo` по workspace — жодної нової колонки
  "Repository" в самій таблиці рядків (мокап її не показує; контекст репо —
  фільтр, не колонка).

**Вкладка CI агента (G11, G1)**

- **AC-31** (event-driven). КОЛИ агент не має жодної `ci_installations`, ТО
  вкладка CI (shall) показати порожній стан із кнопкою "Add to CI"; КОЛИ є
  хоч одна, кнопка тексту (shall) стати "Update CI config" — обидва відкривають
  той самий Export Wizard (G1-G6), різниця лише в тексті кнопки.
- **AC-32** (ubiquitous). Вкладка CI (shall) показати "Fail CI on:
  {agent.ci_fail_on}" READ-ONLY, з лінком/кнопкою, що перемикає на Config
  tab того самого агента — жодного власного стану для цього значення
  (Реконсиляція п.5).
- **AC-33** (ubiquitous). Вкладка CI (shall) показати список інсталяцій
  (repo, target badge, `installed_at`, `workflow_version`) і історію
  останніх `ci_runs` цього агента (той самий рядковий шейп, що CI Runs,
  звужений `WHERE ci_installation_id IN (SELECT id FROM ci_installations
  WHERE agent_id = :id)`).

**Rate limiting (NFR "cost/rate abuse")**

- **AC-34** (ubiquitous). `POST /agents/:id/export-ci` і будь-який
  ендпоінт, що тригерить ingest-цикл (AC-24) (shall) мати
  `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` — той самий
  паттерн і те саме число, що вже прийняте `reviews/routes.ts:33,65`, не
  новий ліміт, вирівняний з існуючою конвенцією.

## Edge cases

- Агент без жодного linked+enabled скіла → Preview (shall) показати лише
  4 файли (без жодного `.devdigest/skills/*.md`), `AgentManifest.skills:
  []` — валідний манiфест, `agent-runner/src/manifest.ts`'s
  `.nullish().transform(v => v ?? [])` вже толерує це на прийомі.
- Два скіли з однаковим slug'ом ("Security Review" і "security-review") →
  дедуплікація AC-9 додає суфікс другому (`security-review-2`) в межах
  ОДНОГО експорту — не персистована колізія, перерахунок при кожному
  новому Preview.
- Користувач тисне "Update CI config" вдруге для того самого агента/репо →
  upsert (AC-4) замінює файли й гілку `devdigest/ci` новим комітом (той
  самий "re-publishing just adds a new commit" контракт, що вже
  задокументований `GitHubClient.commitFiles`'s doc-comment,
  `adapters.ts:156-160`) — не створює другу інсталяцію/PR.
- Прогон CI провалюється до кроку upload (LLM-помилка, невалідний manifest)
  → жодного артефакту в GitHub Actions run — `downloadRunArtifact` (AC-23)
  повертає `null`, ingest (AC-24) просто не створює рядок для цього
  `run_id` — не показує фантомний "failed"-рядок без реальних метрик (сам
  GitHub Actions UI вже показує failed job; студія не намагається
  дублювати це без даних).
- Fork PR запускає workflow → `GITHUB_TOKEN` read-only,
  `OPENROUTER_API_KEY` недоступний (fork-секрети замовчуванням недоступні)
  → `agent-runner` не має чим прогнати LLM-виклик, hard-fail семантика
  (`README.md:108-112`) — жодного артефакту, жодного посту на PR. Ingest
  нічого не бачить для цього прогону (той самий edge case, що вище).
- Дуже старий/видалений агент (записаний в `ci_installations.agentId`, сам
  агент видалений) → `ci_installations.agentId` вже `.references(() =>
  agents.id, {onDelete: 'cascade'})` (`ci.ts:6-8`) — видалення агента
  каскадно видаляє інсталяцію (і транзитивно, через `ciInstallationId
  onDelete: 'set null'` на `ci_runs`, лишає історичні `ci_runs`-рядки з
  `ci_installation_id: null`). AC-28's таблиця (shall) лишати такі рядки
  видимими з fallback "Agent" замість назви — той самий null-safe fallback
  принцип, що вже прийнятий SPEC-07 для видаленого агента в `RunHistory`.
- Дуже великий воркспейс з десятками інсталяцій → polling AC-24 виконується
  по кожній інсталяції послідовно чи конкурентно — конкретна межа
  (rate-limit до GitHub API) — рівень Development Plan, не AC цієї спеки
  (Open questions).

## Non-functional requirements

Пропущено через скіл `security` (OWASP Top 10:2025 / Agentic AI Security
ASI01-ASI09) — цей скіл активно застосований під час написання цієї секції
й секції Untrusted inputs, не лише процитований. Обсяг перевірки — той
самий клас загроз, що вже застосований SPEC-01/03/04/05/06/07, плюс
специфічний для CI/GitHub Actions клас із самої лабораторної.

- **CRITICAL (запобігання, буквальна вимога лабораторної) — `pull_request_target`
  + checkout недовіреного коду (A06 Insecure Design, ASI02 Tool Misuse).**
  Генерований workflow (AC-11) (shall) використовувати ВИКЛЮЧНО `on:
  pull_request` (privileged secrets недоступні на fork), НІКОЛИ
  `pull_request_target` — незалежно від того, наскільки зручнішим це
  здається для доступу до секретів на fork-PR. Жодного кроку в
  генерованому workflow (shall) не чекаутити PR-гілку fork'а окремим
  привілейованим кроком.
- **HIGH — `OPENROUTER_API_KEY` витік через лог/артефакт/коментар
  (A04 Cryptographic Failures, A09 Logging Failures).** `agent-runner`
  вже (за контрактом `README.md:102-103`) ніколи не логує й не пише секрет
  у `devdigest-result.json`/посту — ця спека НЕ змінює цю поведінку, лише
  генерує workflow, що ПОСТАЧАЄ секрет через `secrets.OPENROUTER_API_KEY`,
  ніколи хардкоджений/виведений у `run:`-крок як plain-текст аргумент
  (уникає потрапляння в GitHub Actions log, де аргументи команд видимі).
- **HIGH → MEDIUM (за наявним контролем) — підроблений/застарілий
  `devdigest-result.json` від fork-PR прогону (A08 Software and Data
  Integrity, ASI09 Trust Exploitation).** Fork-PR прогін не має секретів
  (вище), тож не може реально прогнати LLM-рев'ю — але теоретично МІГ БИ
  спробувати написати довільний `devdigest-result.json` власним кроком
  workflow (немає привілеїв, потрібних для цього, окрім написання файлу в
  своєму ж sandboxed runner'і). Мітигація: ingest (AC-26) звіряє
  `commit_sha` з `head_sha`, отриманим від GitHub API САМОГО прогону (не з
  вмісту JSON) — підроблений артефакт, що заявляє чужий SHA, відкидається;
  Zod-схема (AC-25) відкидає структурно невалідний вміст. Залишковий ризик
  — легітимний-виглядний, але фальшивий findings-набір із ПРАВИЛЬНИМ
  `commit_sha` (той самий SHA, що й реальний прогон) — прийнятний ризик
  MVP-рівня, той самий клас, що приймає GitHub Actions загалом для
  будь-якого self-reported CI-статусу; не блокує цю спеку.
- **MEDIUM — cost/rate abuse через `GET /ci/runs`-polling (A06 Insecure
  Design).** `POST /agents/:id/export-ci` і новий ingest-цикл (AC-24)
  (shall) отримати той самий per-route rate limit паттерн, що вже
  прийнятий `reviews/routes.ts:33,65` (AC-34) — не новий ліміт, вирівняний
  з існуючою конвенцією.
- **MEDIUM — довіра до вмісту `PrDetail`/diff/branch names, що зрештою
  потрапляють у промпт (A05 Injection, ASI01 Goal Hijacking).**
  Незмінно: `agent-runner` вже (README/CLAUDE.md, Invariants) обгортає diff
  і PR body через `wrapUntrusted()`+`INJECTION_GUARD` (той самий шлях, що
  локальний рев'ю) ПЕРЕД тим, як вони досягають промпту — ця спека НЕ
  торкається `reviewer-core`/`assemblePrompt`, лише генерує workflow, що
  його викликає. Назва гілки/PR title з fork-PR НІКОЛИ не перетворюється на
  shell-команду в генерованому workflow — усі кроки статичні (`checkout`,
  `node .devdigest/runner/index.js`), жодного інтерполювання
  `${{ github.event.pull_request.title }}` у `run:`-блок (класична
  GitHub Actions script-injection пастка — навмисно уникнута; будь-яке
  майбутнє розширення workflow, що додає такий крок, мусить проходити той
  самий injection-аналіз).
- **MEDIUM — розкриття внутрішньої структури через "Trace"-лінк
  (A01 Broken Access Control, за замовчуванням не проблема тут).**
  "Trace" (AC-29) веде на `ci_runs.github_url` — публічний/приватний
  GitHub UI URL, чия власна авторизація (репо-права користувача в GitHub)
  захищає перегляд, НЕ студія; студія не проксує вміст job-логів і не
  показує їх у власному UI — жодного нового вектора розкриття понад те, що
  GitHub сам вирішив по видимості репо.
- **LOW — stored/reflected XSS у `pull_request title`/`agent.name`,
  відрендерених у таблиці CI Runs (A05 Injection).** Ті самі поля, що вже
  безпечно рендеряться скрізь у застосунку через React JSX text-child
  (авто-escape) — жодного нового `dangerouslySetInnerHTML` для колонок
  PULL REQUEST/AGENT цієї таблиці.
- **LOW — логування ingest-циклу.** Структурований лог кожного
  polling-проходу (AC-24) (shall) нести лише
  `installationId`/`repo`/`runId`/`status`/`findingsCount`/`costUsd` —
  НІКОЛИ вміст `devdigest-result.json`'s потенційних майбутніх текстових
  полів чи будь-якого секрету з env — той самий принцип, що вже прийнятий
  `PROMPT_LOG_VERBOSE`-конвенцією (root `CLAUDE.md`).
- **Прозорість меж авторизації (нове, буквальна вимога лабораторної,
  підтверджена мокапом).** "Block merge on findings" (shall) лишатись
  видимо `disabled` з поясненням причини (AC-16) — застосунок НЕ (shall)
  імітувати захист merge, якого фактично не забезпечує (немає GitHub App/
  branch-protection-керування) — той самий "не приховувати ціну" принцип,
  що вже застосований SPEC-07 до `learn`/`reply`.

## Inputs and provenance

- **Конфігурація агента (`name`/`provider`/`model`/`systemPrompt`/
  `strategy`/`ciFailOn`) + linked+enabled скіли** — вже персистовані
  `agents`/`agent_skills`/`skills` рядки, жодного нового джерела; slug
  обчислюється на льоту (AC-9), не читається з БД.
- **Список workflow-прогонів + артефакт `devdigest-result.json`** — новий
  вхід через GitHub Actions API (AC-22, AC-23), автентифікований власним
  довгоживучим `GITHUB_TOKEN` студії (той самий токен, що вже й для diff/
  PR-фетчу) — не новий тип довіри, той самий адаптер.
- **`ci_installations`/`ci_runs`** — нові persisted метадані,
  записувані сервером у момент Install (AC-19) і кожного ingest-циклу
  (AC-24) — не зовнішній довільний вхід, детерміновані власними API-
  викликами студії.
- **`devdigest-result.json`'s вміст** — вироблений `agent-runner`, що
  запускається в чужій CI, на основі diff/PR title/body ЦІЛЬОВОГО репо —
  недовірений на вході (Untrusted inputs нижче), хоч і "власний" продукт
  застосунку.

## Untrusted inputs

- **`devdigest-result.json` (артефакт з чужого GitHub Actions прогону)** —
  недовірений НЕЗАЛЕЖНО від того, що його виробив "наш" код
  (`agent-runner`), бо виконується в чужому середовищі під потенційним
  впливом чужого PR-контенту. Ingest (shall) ЗАВЖДИ `safeParse` через
  `CiResultArtifact` (AC-25) ПЕРЕД будь-яким записом, і (shall) звіряти
  `commit_sha` з незалежно отриманим `head_sha` GitHub API (AC-26) —
  ніколи довіряти самому JSON як єдиному джерелу істини про те, який
  коміт він описує.
- **Diff / PR title / PR body / branch names (у самому CI-прогоні,
  `agent-runner`'s зона відповідальності, не цієї спеки)** — без змін,
  той самий `wrapUntrusted()`/`INJECTION_GUARD` шлях, що вже прийнятий і
  протестований (`agent-runner/README.md`'s Invariants); ця спека лише
  генерує workflow, що його викликає, і НЕ додає жодного нового кроку, що
  б інтерполював ці значення в shell/`run:`-блок (NFR вище).
- **`agents.name`/`skills.name` (введені власником агента, довірений
  локальний контент студії — НЕ untrusted)** — використовуються для
  slug-обчислення (AC-9): slugify (shall) видаляти/замінювати будь-які
  символи поза `[a-z0-9-]` перед використанням як частина файлового шляху
  в `commitFiles`'s `CommitFile.path` — захист від малоймовірного, але
  дешевого до перевірки path-traversal через ім'я агента/скіла з "..","/"
  тощо, а не тому, що це користувач-із-зовні контент.
- **`repo` (текстове поле "owner/name", введене власником агента у
  Configure/Target)** — це вибір ЦІЛІ дії (яке repo отримає закомічені
  файли), не контент, що потрапляє в промпт; недовіра тут — access-control-
  класу (сервер (shall) використовувати той самий `GITHUB_TOKEN`, чиї
  реальні права на цей `repo` перевіряє сам GitHub API під час
  `commitFiles`/`openPullRequest` — 403 від GitHub, якщо токен не має прав,
  не обходиться жодним локальним чеком).

## Open questions

- **Settings → Integrations (мокап N9) — той самий wizard чи окремий
  флоу "прив'язати репо на рівні workspace"?** Секція не існує в коді;
  ця спека її НЕ додає (Non-goals). `[NEEDS CLARIFICATION]` для майбутньої
  спеки, коли/якщо ця секція будується.
- **Rate-limit/throughput конкретної межі polling-циклу (AC-24) за великої
  кількості інсталяцій** — NFR визначає ПРИНЦИП (per-route rate limit,
  той самий паттерн), конкретне число паралельних GitHub API-викликів чи
  cron-інтервал auto-refresh — рівень Development Plan, не AC цієї спеки.
- **Чи workflow-версія (`ci_installations.workflow_version`, AC-8 модуля
  G11) — семвер самого генератора студії, чи хеш вмісту згенерованого
  workflow-файлу** — обидва варіанти сумісні з AC-33 ("показати версію
  workflow"); конкретний формат — implementation-рівня рішення, не
  зафіксоване тут навмисно.
- **Точний UI "вкладки CI сторінки агента" поза тим, що зафіксовано в AC-31/
  AC-32/AC-33** (верстка інсталяцій-списку, чи є окрема кнопка "Remove
  installation") — дизайн-мокап для цього артборду НЕ підтверджений
  користувачем повністю (лише кнопка Add-to-CI/Update і кілька рядків
  історії помічені як побачені) — AC фіксують поведінку, не піксельну
  верстку; аналогічно до Configure run screen у SPEC-07.
- **Чи потрібен UI-контрол "Remove CI installation" (видалити гілку/PR/
  запис) у цій версії, чи видалення відбувається лише вручну через
  видалення файлів у цільовому репо** — лабораторна й мокап не згадують
  жодного "uninstall"-флоу; не додається цією спекою, лишається відкритим.

## Task checklist

- [ ] T1 Контракти: портувати `AgentManifest`/`AgentManifestInput` у
      клієнтську копію `eval-ci.ts`; додати `commit_sha`/`model`/
      `agent_version` до `CiResultArtifact` (обидві копії) → AC-1, AC-2 →
      `server/test/contracts.test.ts` + новий `client`-side тест на
      round-trip парсингу (client не має окремого `contracts.test.ts` —
      додати мінімальну перевірку в `client/src/lib/hooks/agents.test.ts`
      чи новий `client/src/vendor/shared/contracts/eval-ci.test.ts`)
- [ ] T2 DB: нова migration — `ci_runs.{commit_sha,model,agent_version,
      duration_s,critical,warning,suggestion}`, `ci_installations.workflow_version`,
      новий `uniqueIndex` на `ci_installations(agent_id, repo, target_type)`
      (`pnpm db:generate`) → AC-3, AC-4 → новий
      `server/test/ci-export.it.test.ts` (колонки існують, upsert на unique
      index не дублює рядок)
- [ ] T3 Сервер: новий модуль `server/src/modules/ci/` — `routes.ts` +
      `service.ts` + `repository.ts` + `manifest.ts` (серіалізація
      `AgentManifest`+slug-обчислення, AC-8, AC-9) + `workflow.ts`
      (генерація `devdigest-review.yml`, AC-11) — шляхи буквально ті, що
      вже цитує `agent-runner`'s власна документація
      (`agent-runner/src/manifest.ts:9`, `agent-runner/CLAUDE.md`) →
      AC-5 - AC-14 → новий `server/test/ci-manifest.test.ts` (юніт, чиста
      функція: manifest round-trips через `AgentManifest.safeParse`, slug
      dedup колізії) + новий `server/test/ci-workflow.test.ts` (юніт:
      згенерований YAML має правильний secret-ім'я, permissions-блок, пінed
      SHA, без `pull_request_target`)
- [ ] T4 Сервер: `POST /agents/:id/export-ci` — `action: 'files'` (Preview,
      AC-7, AC-10) і `action: 'open_pr'` (Install, AC-18-AC-21, підключає
      `GitHubClient.commitFiles`+`findOpenPr`+`openPullRequest`, гілка
      `devdigest/ci`) → AC-7 - AC-21 → новий
      `server/test/ci-export.it.test.ts` (Testcontainers: files-шлях
      повертає 6 файлів без запису БД; open_pr-шлях записує
      `ci_installations`, мокований `GitHubClient`)
- [ ] T5 Сервер: `adapters.ts` — нові методи `listWorkflowRunsFor`/
      `downloadRunArtifact` на `GitHubClient`; реалізація в
      `octokit.ts` + мок у `mocks.ts` → AC-22, AC-23 → новий
      `server/test/github-workflow-runs.test.ts` (юніт на мок/фікстуру
      GitHub API відповіді)
- [ ] T6 Сервер: ingest-цикл (`CiService.refreshInstallation`/
      `refreshAll`) — polling + Zod-валідація + commit_sha-звірка +
      upsert `ci_runs` + insert `agent_runs`(source='ci') → AC-24, AC-25,
      AC-26 → новий `server/test/ci-ingest.it.test.ts` (Testcontainers:
      валідний артефакт → 2 нові рядки; невалідний JSON → 0 рядків;
      commit_sha mismatch → 0 рядків)
- [ ] T7 Сервер: `GET /ci/runs` (workspace-scoped, фільтри
      since/agent_id/repo/status/source) → AC-28, AC-30 → новий
      `server/test/ci-runs-list.it.test.ts`
- [ ] T8 Сервер: `GET /agents/:id/ci` (інсталяції + `ci_fail_on` +
      історія прогонів цього агента) → AC-31, AC-32, AC-33 → розширений
      `server/test/ci-export.it.test.ts`
- [ ] T9 Сервер: rate limit на `POST /agents/:id/export-ci` і на
      ingest-тригер ендпоінт (`config: {rateLimit: {max: 10, timeWindow:
      '1 minute'}}`, той самий паттерн `reviews/routes.ts`) → AC-34 →
      покривається тестами T4/T6 (перевірка заголовків чи 429 на
      перевищення — опційно окремий тест)
- [ ] T10 `agent-runner`: `context.ts`'s `resolvePrContext`/`PrContext` —
      додати `headSha` (з `pull_request.head.sha` у event payload, чи
      `GITHUB_SHA` env fallback) → AC-2 (значення `commit_sha`) →
      розширений `agent-runner/src/context.test.ts` (новий, чи доданий у
      `run.test.ts` — перевірити фактичний файл перед вибором) — **читати
      `agent-runner/CLAUDE.md`'s "Do Not Touch Without Reading" перед
      правкою `index.ts`/`context.ts`, і `agent-runner/insights/INSIGHTS.md`
      перед стартом**
- [ ] T11 `agent-runner`: `artifact.ts`'s `BuildResultArtifactInput`/
      `buildResultArtifact` — прийняти `commitSha`/`model`/`agentVersion`,
      записати в `CiResultArtifact` → AC-2 → розширений
      `agent-runner/src/artifact.test.ts` (перевірити фактичну назву файлу
      — можливо тести artifact-логіки лежать у `run.test.ts`, звірити перед
      написанням)
- [ ] T12 Клієнт: новий `_components/ExportWizard/` (Target/Preview/
      Configure/Install кроки, перевикористовує `ExportWizardSteps`) →
      AC-5, AC-6, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19,
      AC-20 → новий `ExportWizard.test.tsx` (по одному тесту на крок
      мінімум)
- [ ] T13 Клієнт: `AgentEditor/constants.ts`'s `TABS` — новий запис
      `{key: "ci", labelKey: "editor.tabs.ci", icon: ...}`; новий
      `_components/CiTab/` (Add-to-CI/Update button, Fail-CI-on read-only
      лінк на Config, історія інсталяцій+прогонів) → AC-31, AC-32, AC-33 →
      новий `CiTab.test.tsx`
- [ ] T14 Клієнт: нова сторінка `app/ci-runs/page.tsx` + `_components/
      CiRunsView/` (таблиця+фільтри+Refresh+auto-refresh) → AC-27, AC-28,
      AC-29, AC-30 → новий `CiRunsView.test.tsx`
- [ ] T15 Клієнт: `lib/hooks/ci.ts` (новий) — `useExportCi`,
      `useAgentCi`, `useCiRuns`, `useRefreshCi` → AC-19, AC-20, AC-28,
      AC-33 (живить T12-T14) → нові тести хука поруч (той самий паттерн
      `agents.test.ts`)
- [ ] T16 i18n: нові ключі під `client/messages/en/ci.json` (Export to CI,
      Target/Preview/Configure/Install, Add to CI, Update CI config, Fail
      CI on, тощо) → жоден новий AC (лише i18n) → покривається тестами
      T12-T14
