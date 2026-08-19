# INSIGHTS — server (`@devdigest/api`)

Знахідки по серверу, включно з `repo-intel`. Append-only — див.
[`.claude/skills/engineering-insights`](../.claude/skills/engineering-insights/SKILL.md).

---

## 2026-07-28 · gotcha
**`TESTING.md` заявляє `skip-worktree` на `server/package.json`, але прапорець не встановлений**
Документація пояснює через це, чому CI викликає `pnpm exec vitest run …` замість
скриптів `test:unit`/`test:integration`. У цьому клоні `git ls-files -v` не
показує жодного прапорця — тобто локальні правки `server/package.json` **потраплять**
у коміт, усупереч очікуванню з документа. Перевіряй перед комітом.
Доказ: TESTING.md:83

## 2026-07-28 · gotcha
**`tsx src/db/migrate.ts`, викликаний напряму через `node_modules/.bin/tsx`, мовчки нічого не робить**
CLI-entrypoint guard `import.meta.url === file://${process.argv[1]}` не
спрацьовує, коли скрипт запущено через shell-обгортку `.bin/tsx` — процес
завершується з exit 0 і без жодного виводу, міграції НЕ застосовуються. Працює
лише `pnpm db:migrate` (де `argv[1]` резолвиться інакше) або прямий імпорт і
виклик `runMigrations(url)` з окремого entry-скрипта. Мовчазний "успіх" тут —
пастка: перевіряй результат по факту (`\d agent_runs` тощо), а не по коду виходу.
Доказ: server/src/db/migrate.ts:37

## 2026-08-01 · gotcha
**`ValidationError` повертає 422, а не 400**
Глобальний error handler у `app.ts` диспатчить будь-який `AppError`-нащадок на
`reply.status(err.statusCode)`, і його ж коментар каже: "Validation → 422;
AppError → its status." Тож роут/тест, що кидає `ValidationError` і очікує
400, отримає 422. Перевірено на `POST /skills/import/preview` з невалідним
розширенням файлу — тест з `expect(...).toBe(400)` падав із фактичним 422;
виправлення на 422 пройшло.
Доказ: server/src/platform/errors.ts:25-29; server/src/app.ts:116

## 2026-08-02 · fix
**Прив'язані скіли агента ніколи не потрапляли в промпт рев'ю — `run-executor.ts` не резолвив їх**
`reviewer-core`'s `reviewPullRequest`/`assemblePrompt` вміли приймати
`skills: string[]` від самого початку, і `AgentsRepository.linkedSkills`
теж давно повертав прив'язані скіли з їх `enabled`-прапорцем — але
`ReviewRunExecutor` ніколи не викликав перше друге для заповнення
`skills`. UI показував "N skills" на картці агента, Skills-таб дозволяв
прив'язувати їх — а `prompt_assembly.skills` у трейсі завжди був `null`.
Фікс: перед викликом `reviewPullRequest` резолвити
`this.agents.linkedSkills(agent.id)`, відфільтрувати за `skill.enabled`,
передати тіла як `skills` і id-шки — в `agent_runs.skill_ids` (нова
колонка) для подальшої аналітики.
Доказ: server/src/modules/reviews/run-executor.ts:186-192,214

## 2026-08-02 · gotcha
**`tsx src/db/seed.ts` теж мовчки нічого не робить при прямому запуску (той самий баг, що й у migrate.ts)**
Той самий CLI-entrypoint guard (`import.meta.url === file://${argv[1]}`)
ламається, коли шлях до репо містить пробіл (`.../ai agent/dev-digest`) —
торкається БУДЬ-ЯКОГО скрипта в репо з таким guard'ом, не лише
`migrate.ts` (див. запис від 2026-07-28). Для `seed.ts` перевіряй
результат прямим SQL-запитом, а не кодом виходу процесу.
Доказ: server/src/db/seed.ts:321

## 2026-08-02 · gotcha
**`RepoIntel`-інтерфейс не встигав за конкретним класом: `readFiles` був у `RepoIntelService`, але не в інтерфейсі**
`container.repoIntel` типізований через інтерфейс `RepoIntel`, а не через
конкретний клас — тож будь-який новий метод, доданий лише в
`RepoIntelService`, не типчекнеться для інших модулів, поки не додати
сигнатуру і в інтерфейс. `readFiles` (Task 1 плану conventions-extractor)
якраз так і залишився — реалізація була, а в `RepoIntel` — ні. Перевіряй
`grep -n "implements RepoIntel"` перед тим, як довіряти, що метод класу
доступний через `container.repoIntel`.
Доказ: server/src/modules/repo-intel/types.ts:163 (сигнатура додана поруч
з `getConventionSamples`), реалізація — server/src/modules/repo-intel/service.ts:638

## 2026-08-02 · gotcha
**`readClone()` мовчки повертає `[]`, якщо шлях фікстури на диску не збігається з repo-relative шляхом у даних — виглядає як "LLM нічого не витягнув"**
`readClone(clonePath, file)` робить `readFile(join(clonePath, file))` і
ковтає помилку в `null` (server/src/modules/repo-intel/service.ts:779-780)
— це навмисний best-effort контракт для `readFiles()`. Але в
інтеграційному тесті це означає: якщо `file_rank.filePath` /
LLM-selection / `evidence_path` всі кажуть `src/service.ts`, а фікстура
фізично лежить у `clonePath/service.ts` (без `src/`), `readFiles()` тихо
поверне `[]`, і `ConventionsService.extract()` деградує до порожнього
списку без жодної помилки — симптом виглядає як "модель нічого не
вибрала", хоча насправді файл просто не знайшли на диску.
Доказ: server/test/conventions.it.test.ts (фікстура пишеться в
`join(clonePath, 'src', 'service.ts')`, щоб збігтись з usages по всьому
тесту); readClone — server/src/modules/repo-intel/service.ts:779

## 2026-08-02 · gotcha
**Немає жодного прецеденту `db.transaction(...)` у `server/src` — `grep -rn "transaction" server/src` знаходить лише коментар у `seed-prompts.ts`**
Коли треба обгорнути кілька repository-викликів в одну транзакцію (напр.
`deleteUnaccepted` + `insertMany` в conventions), немає усталеного
патерну "проброс tx через сервіс" — довелось завести його самому:
repository-методи (`insertMany`, `deleteUnaccepted`) приймають
опціональний `db: Db = this.db` останнім параметром, а новий метод
(`replaceUnaccepted`) відкриває `this.db.transaction(async (tx) => {...})`
і прокидає `tx` замість `this.db` у внутрішні виклики. Наступного разу,
коли знадобиться транзакція деінде — або йди цим шляхом, або онови цей
запис, якщо з'явиться кращий спільний патерн.
Доказ: server/src/modules/conventions/repository.ts:68-81

## 2026-08-02 · decision
**Юніт-тест сервісу без Postgres: патчимо приватне поле `repo` напряму через `as unknown as {repo: ...}`, а не мокаємо весь `Container`**
`ConventionsService`/`RepoIntelService` створюють свій repository у
конструкторі (`this.repo = new XRepository(container.db)`), тож щоб
протестувати саму сервісну логіку (напр. filter-guard від
hallucinated-шляхів у `extract()`) без Testcontainers, треба збудувати
мінімальний `Container`-like об'єкт лише з тими полями, які сервіс
реально читає (тут: `repoIntel`, `llm`, і фіктивний `db` для
`resolveFeatureModel`), а потім переписати `service['repo']` напряму —
той самий трюк, що й у `repo-intel-facade-degraded.test.ts`. `container.db`
можна лишити тонким стабом (`select().from().where()` → `[]`), якщо
сервіс лише читає через нього settings-override, який однаково відсутній.
Доказ: server/test/conventions-file-guard.test.ts:24-58 (новий тест),
патерн-прецедент — server/test/repo-intel-facade-degraded.test.ts:27-38

## 2026-08-02 · gotcha
**Fastify `app.inject()` без `payload` шле `null`-тіло, а не `undefined` — це валить zod `body: Schema.optional()`**
Роут `POST /repos/:repoId/conventions/extract` отримав `body:
ExtractBody.optional()`, а існуючі виклики в тесті були
`app.inject({ method: 'POST', url })` без `payload` взагалі. Це давало
422 `Expected object, received null` — light-my-request підставляє
`null`, коли `payload` не передано і немає `Content-Type`, а
`fastify-type-provider-zod` перевіряє body ще до хендлера, тож
`req.body?.x` у коді ніколи не встигає обробити цей випадок. Фікс:
явно передавати `payload: {}` у тестових викликах з порожнім тілом
(не production-баг — суто особливість `inject()`).
Доказ: server/test/conventions.it.test.ts:98-102

## 2026-08-02 · gotcha
**Зміна дефолтного значення параметра сервісу («мовчазна» зміна поведінки при виклику без аргументу) тихо ламає юніт-тест, написаний до появи цього параметра**
`ConventionsService.extract()` отримав третій параметр `samplingMode:
'code' | 'llm' = 'code'` (Task 4), а `conventions-file-guard.test.ts`
викликав `service.extract('ws1', 'repo1')` без нього — до Task 4 це
завжди йшло 2-step LLM-гілкою (де і живе filter-guard, який тест
перевіряє), а після — пішло новою 'code'-гілкою, яка взагалі не
викликає `ConventionFileSelection`, тож guard ніколи не спрацьовував і
`readFiles` викликався 3 рази замість очікуваного 1. `tsc --noEmit`
цього не ловить (параметр опціональний, тип валідний) — спливає лише
на прогоні тестів. Урок: зміна дефолту опціонального параметра
вимагає explicit-перевірки викликів без цього аргументу по всьому
репо, не лише в місцях, які сам таск торкається.
Доказ: server/test/conventions-file-guard.test.ts:64 (виклик тепер
явно `service.extract('ws1', 'repo1', 'llm')`)

## 2026-08-03 · gotcha
**`PrDetail.linked_issue` НІКОЛИ не персистується в БД — це live-фетч лише в
`GET /pulls/:id`, а не поле на `pull_requests`**
План Intent Layer стверджував, що лінкований issue "already resolved at
ingestion time... persisted on PrDetail.linked_issue" — і план цитував саме
рядок `octokit.ts:118` як доказ персистентності. Насправді `linked_issue`
збирається виключно всередині обробника `GET /pulls/:id` (виклик
`gh.getPullRequest(...)` прямо в роуті, не при імпорті PR) і ніде не
записується в `pull_requests`/окрему таблицю. Будь-який фоновий процес (як
`ReviewRunExecutor`, що не проходить через цей HTTP-роут) не має лінкованого
issue "безкоштовно" з рядка БД — його потрібно фетчити наживо через
`container.github()`, обов'язково best-effort (немає токена / офлайн →
деградація до `undefined`, не throw).
Доказ: server/src/modules/pulls/routes.ts:222-223 (live-фетч у роуті) vs
відсутність `linkedIssue`/`linked_issue` колонки в
server/src/db/schema/pulls.ts

## 2026-08-03 · gotcha
**Додавання required-полів (`confidence`/`source`) до `Intent` контракту
ламає готовий fixture-тест `Intent.parse(...)` — компілятор цього не ловить**
`server/test/contracts.test.ts` мав `Intent.parse({ intent, in_scope,
out_of_scope })` без `confidence`/`source` — це компілювалось (бо тест не
типізований проти нового `z.object`, а викликає `.parse` на рантаймовому
значенні), але падало б на рантаймі з ZodError після розширення схеми
required-полями. `tsc` тут безсилий: ловиться лише прогоном тестів.
Перевіряй `grep` фікстур/фікстур-білдерів контракту, який розширюєш required
полями, а не лише типи, що на нього спираються.
Доказ: server/test/contracts.test.ts:68-76 (фікстуру доповнено
`confidence: 'high', source: 'description'` після розширення `Intent` в
server/src/vendor/shared/contracts/brief.ts:9-25)

## 2026-08-03 · decision
**"Local-only debug toggle" реалізовано як hard gate в `loadConfig`, а не
як просто задокументоване правило "не вмикай у проді"**
`PROMPT_LOG_VERBOSE` (детальний per-section розпис у структурованому
логі складання промпта) обчислюється як `parsed.PROMPT_LOG_VERBOSE ===
'true' && parsed.NODE_ENV !== 'production'` прямо у `loadConfig` —
помилково виставлена змінна оточення в проді фізично не може увімкнути
verbose-режим, це не покладається на дисципліну деплою. Патерн вартий
повторного використання для будь-якого майбутнього "тільки локально"
прапорця: гейт у самій функції парсингу конфіга, не коментар поруч зі
змінною.
Доказ: server/src/platform/config.ts:79 (`promptLogVerbose: parsed.
PROMPT_LOG_VERBOSE === 'true' && parsed.NODE_ENV !== 'production'`),
перевірено тестом server/test/config.test.ts:24-28 (`NODE_ENV:
'production'` → `false` навіть при `PROMPT_LOG_VERBOSE: 'true'`)

## 2026-08-04 · gotcha
**Зміна дефолтного провайдера в `FEATURE_MODELS` може непомітно зламати
герметичність `*.it.test.ts`, і це видно не одразу**
Зміна `FEATURE_MODELS['review_intent'].defaultProvider` з `'openai'` на
`'openrouter'` (`server/src/vendor/shared/contracts/platform.ts:53-60`)
зламала герметичність усіх `server/test/*.it.test.ts`, що запускають
рев'ю через `POST /pulls/:id/review`: ці тести мокають лише
`overrides.llm.openai` (бо саме такий provider у тестового review-агента),
а `review_intent` раніше ТЕЖ був `openai` — тобто класифікація intent
випадково потрапляла під той самий мок. Після зміни дефолту
`container.llm('openrouter')` (`server/src/platform/container.ts:163-179`)
почав провалюватись до РЕАЛЬНОЇ побудови провайдера на будь-якій машині, де
в `~/.devdigest/secrets.json`/`process.env` є справжній
`OPENROUTER_API_KEY` — це дало реальні ~8-10с мережеві виклики всередині
"герметичного" Testcontainers-тесту й нестабільні падіння в
`server/test/reviews-skills.it.test.ts`, бо дефолтний 10с таймаут
`waitForPrRuns` (`server/test/helpers/runs.ts:17`) встигав спрацювати
раніше, ніж run доходив до термінального статусу (`trace.prompt_assembly`
лишався `undefined`). Виправлено додаванням явного
`openrouter: new MockLLMProvider(...)` поруч з `openai`/`anthropic` у
кожному `it.test.ts`, що тригерить рев'ю
(`reviews-skills.it.test.ts`, `agent-stats.it.test.ts`, `reviews.it.test.ts`).
Правило на майбутнє: будь-яка зміна дефолтного провайдера в
`FEATURE_MODELS` вимагає звірки з llm-моками у ВСІХ `it.test.ts`, не лише
з тестами самої фічі — прогалина в моку не видно, доки на машині випадково
не виявиться справжній ключ саме для цього провайдера.
Доказ: server/src/platform/container.ts:163-179 (`buildLlm` — падає в
реальний провайдер, коли `overrides.llm[id]` відсутній), server/test/reviews-skills.it.test.ts
(додано `openrouter` мок після виправлення)

## 2026-08-06 · gotcha
**Невалідний `POST /agents` у Testcontainers-тесті провалюється МОВЧКИ й
маскується під "run ніколи не завершується" (10с таймаут `waitForPrRuns`)**
Пропущене required-поле `provider` в тілі `POST /agents` (схема
`CreateAgentBody`) валиться на Zod-валідації з 400 — `app.inject(...).json()`
повертає error-об'єкт без `id`. Наступний
`POST /pulls/:id/review payload:{agentId: undefined}` серіалізується у JSON
БЕЗ ключа `agentId` (бо `JSON.stringify` дропає `undefined`-значення), тобто
`resolveTargets` кидає `invalid_run_request` — жодного `agent_runs` рядка не
створюється. `waitForPrRuns(db, prId, {expected:1})` в цьому випадку не бачить
ЖОДНОГО рядка (не лише незавершеного) і чесно чекає весь `timeoutMs` (10с)
перш ніж повернутись — симптом виглядає як "run досі виконується", а не як
"агент не створився". Перевіряй `agent.id` одразу після `POST /agents` у
новому тесті, а не лише в кінці ланцюжка.
Доказ: server/src/modules/agents/routes.ts:34-45 (`provider: Provider` —
required, без `.optional()`), server/test/helpers/runs.ts:17-30
(`waitForPrRuns` — таймаут, а не помилка, коли рядків нема зовсім)

## 2026-08-06 · decision
**`reviews.workspace_id` уже лежить на самому рядку review — не треба
протягувати `workspaceId` через `ReviewService.findingsForRun(runId)`**
Додаючи `GET /runs/:id/findings` (лукап review+findings по самому `run_id`,
без join через `agent_runs`/`pull_id`), треба той самий agent-name lookup, що
й у `reviewsForPull` (`agents.getById(workspaceId, agentId)`), а `workspaceId`
у викликача (роута) немає — і не повинно бути, весь сенс роута в тому, щоб
працювати від голого `run_id`. Рішення: `workspaceId` береться з уже
знайденого рядка (`review.workspaceId`), а не з параметра методу — сигнатура
лишається `findingsForRun(runId: string)`, роут лишається справді unscoped-by-
design.
Доказ: server/src/modules/reviews/service.ts:234-244 (`this.agents.getById(review.workspaceId, review.agentId)`),
server/src/db/schema/reviews.ts:11-13 (`workspaceId` — required колонка на `reviews`)

## 2026-08-06 · gotcha
**`IdParams` (`z.string().uuid()`) валідує `:id` роута ще ДО хендлера — тест
на "невідомий id" з не-UUID рядком отримає 422, а не очікувані 404**
Для `GET /runs/:id/findings` (і будь-якого іншого `:id`-роута на `IdParams`)
герметичний `app.inject()`-тест, що перевіряє 404-гілку "id не знайдено",
мусить використовувати UUID-подібний рядок навіть для "невідомого"
значення — інакше запит взагалі не доходить до сервісу/репозиторію,
падає на zod-валідації params і повертає 422 `validation_error`.
Доказ: server/src/modules/_shared/schemas.ts:11 (`IdParams = z.object({ id:
z.string().uuid() })`), server/test/reviews-findings-by-run.test.ts (UUID-
подібний `UNKNOWN_RUN_ID` замість довільного рядка)

## 2026-08-06 · decision
**Герметичний (без Postgres) тест на HTTP-роут можливий через мінімальний
фейковий `Db`, якщо одночасно підмінити `overrides.auth`**
`buildApp({db, overrides})` дозволяє підсунути фейковий `Db`, що реалізує
лише ТОЧНІ ланцюжки `select().from(table).where()...`, які реально викликає
роут під тестом — усе інше (напр. boot-time `reapStaleRunningRuns()`) можна
безпечно проігнорувати/кинути помилку, бо цей викоп обгорнутий у try/catch
(non-fatal warn) в `app.ts`. Але без підміни `overrides.auth` кожен роут, що
викликає `getContext()`, впаде на `LocalNoAuthProvider`'s реальних запитах
до `users`/`workspaces` — підміни на фейковий `AuthProvider` теж потрібна.
Доказ: server/src/app.ts:80-85 (try/catch навколо `reapStaleRuns()`),
server/src/adapters/auth/local.ts:20-37 (`LocalNoAuthProvider` реально ходить
у `db.select()`), server/test/reviews-findings-by-run.test.ts (fakeDb +
`overrides: { auth }`)

## 2026-08-07 · fix
**`repo-intel`'s `tryPersistentBlast` капало caller'и ГЛОБАЛЬНО (`.slice(0,
MAX_CALLERS_PER_SYMBOL)` на весь змерджений масив), а не per-`viaSymbol` —
PR, що чіпає 2+ експортованих символи, міг лишити один символ зовсім без
caller'ів**
Симптом непомітний доти, доки PR не зачепить 2+ символи одночасно з великим
фан-аутом на один з них — тоді другий символ тихо голодує (0 caller'ів у
відповіді, хоча вони реально є в індексі). Фікс: групувати `callerRows` за
`viaSymbol` ПЕРЕД сортуванням+зрізом, капати кожну групу окремо на
`MAX_CALLERS_PER_SYMBOL`, і лише потім зливати назад у плаский масив.
Регресійний тест навмисно будує 25+25 caller'ів на два символи, щоб довести:
до фіксу глобальний зріз на 40 рядків лишав 20 ЗАГАЛОМ (не по 20 на символ).
Доказ: server/src/modules/repo-intel/service.ts:381-395 (групування за
`viaSymbol` перед `.slice(0, MAX_CALLERS_PER_SYMBOL)`), server/test/repo-intel-blast-fixes.test.ts

## 2026-08-07 · decision
**`BlastResult.factsByFile` перекладено з "caller file → facts" на "ЗМІНЕНИЙ
файл → facts об'єднані по 2-hop reverse-import walk" — стара семантика
пропускала ендпоінт, що знаходиться за 2 імпорти від зміненого файлу**
Стара логіка юнила `file_facts` лише для файлів, що НАПРЯМУ викликають
змінений символ (`getResolvedCallers`'s `fromPath`). Ланцюжок "спільний
хелпер → сервіс → route-файл" (2 hops) НІКОЛИ не спрацьовував: route-файл не
є прямим caller'ом, лише caller транзитивно імпортується ним. Новий
`reverseImportersWithinHops(edges, [changedFile], BFS_DEPTH)`
(`pipeline/reverse-importers.ts`) рахує reverse-BFS від САМОГО зміненого
файлу (не від caller-файлів), а `factsByFile` тепер ключується зміненим
файлом. Підтверджено нуль інших споживачів старого кейінгу (лише
`repo-intel-facade-degraded.test.ts` торкався методу, і не перевіряв
`factsByFile`) — безпечно змінити семантику без downstream-міграції.
Доказ: server/src/modules/repo-intel/service.ts:397-430, server/src/modules/repo-intel/types.ts:79-88
(оновлений doc comment), server/test/repo-intel-blast-fixes.test.ts (2-hop кейс)

## 2026-08-07 · gotcha
**`RepoIntelRepository.getResolvedCallers` INNER JOIN-ить `file_rank` — файл
без рядка в `file_rank` мовчки випадає з відповіді, а не повертається з
`rank: 0`**
У `blast.it.test.ts`-подібному інтеграційному тесті (seed через реальні
`insertSymbols`/`insertReferences`/`replaceEdges`/`resolveReferences`) легко
забути, що КОЖЕН файл, який є caller'ом (`references.from_path`), мусить
мати відповідний рядок `file_rank` — інакше `getResolvedCallers` поверне []
для цього caller'а, і виглядатиме так, ніби `resolveReferences` не
відпрацював, хоча `decl_file` насправді резолвнувся правильно. Симптом:
"чому blast повертає 0 caller'ів, хоча references явно є в таблиці" —
дебажиться довше, ніж мало б, бо помилка не в join-умові на references, а в
ВІДСУТНЬОМУ file_rank рядку.
Доказ: server/src/modules/repo-intel/repository.ts:516-523 (`.innerJoin(t.fileRank, ...)`),
server/test/blast.it.test.ts (кожен з трьох fixture-файлів отримує явний
`replaceFileRank` рядок саме через цю пастку)

## 2026-08-11 · gotcha
**`readClone()` не має захисту від path traversal — досі нешкідливо лише тому,
що жоден викликач не передає client-supplied шлях**
`readClone(clonePath, file)` робить `readFile(join(clonePath, file), 'utf8'))`
без `path.resolve`+prefix-перевірки — шлях типу `../../../../etc/passwd` чи
абсолютний шлях пройде як є через `join()`. Зараз це не експлуатується,
бо єдиний споживач (`readFiles`) отримує шляхи лише з server-derived джерел
(напр. `intent-service.ts:178` — один plan-spec шлях, знайдений regex'ом з PR
body, не з прямого клієнтського input). Плановане SPEC-01-project-context.md
(`docs/specs/SPEC-01-project-context.md`) стане першим викликачем, де шлях
документа приходить від клієнта й персистується в БД — тож перш ніж
підключати attach/detach до `readFiles`, `readClone` (або новий шар над ним)
має валідувати: резолвлений шлях лишається під `resolve(clonePath)` і під
одним з дозволених коренів, і на запис (attach), і повторно на кожне
run-time читання.
Доказ: server/src/modules/repo-intel/service.ts:840-842

## 2026-08-11 · gotcha
**`reviewer-core` вже повністю приймає `specs` end-to-end — сервер просто
ніколи їх не заповнює, `specs_read` хардкоджений у `[]`**
`PromptParts.specs`/`ReviewInput.specs`/`PromptAssembly.specs` існують і
`assemblePrompt()` вже рендерить кожен елемент через
`wrapUntrusted('spec-${i}', …)` у `## Project context`
(`reviewer-core/src/prompt.ts:141-227`) — але `ReviewRunExecutor.runOneAgent()`
ніколи не передає `specs` у виклик `reviewPullRequest({...})`
(server/src/modules/reviews/run-executor.ts:261-288), і `RunTrace.specs_read`
завжди `[]` (рядки 385, 535). `reviewer-core/README.md:32` прямо документує
`specs` як "L05"-слот — тобто це не забутий баг, а свідомо незавершена робота:
уся імплементація Project Context (SPEC-01) — на server (discovery + БД +
проброс у `run-executor`) і client (UI), `reviewer-core` міняти не треба.
Доказ: reviewer-core/src/prompt.ts:141-227; server/src/modules/reviews/run-executor.ts:261-288,385,535;
reviewer-core/README.md:32

## 2026-08-11 · fix
**Спростовує частину запису від 2026-07-28: `pnpm db:migrate` теж мовчки нічого
не робить у цьому клоні — не тільки прямий `node_modules/.bin/tsx`**
Запис від 2026-07-28 стверджував "працює лише `pnpm db:migrate`". Перевірено
фактично (не по коду виходу — по `\d agent_context_docs` і по
`select created_at from drizzle.__drizzle_migrations`): після `pnpm db:migrate`
(exit 0, "Done in 179ms") нові таблиці НЕ з'явились, і найновіший рядок у
`__drizzle_migrations` мав дату на тиждень старішу за сьогодні — тобто
команда справді нічого не застосувала, попри "успішний" вихід. Той самий
CLI-entrypoint guard (`import.meta.url === file://${process.argv[1]}`,
`server/src/db/migrate.ts:37`) ламається і через `pnpm`-обгортку в цьому шляху
репозиторію (містить пробіл — `.../ai agent/dev-digest`), не лише при
прямому виклику `tsx`. Спрацював лише варіант "прямий імпорт і виклик
`runMigrations(url)`" з окремого одноразового entry-скрипта поза
`argv[1]`-перевіркою — саме той workaround, який запис від 2026-07-28 подає
як запасний, а не основний. Висновок: у цьому репо `pnpm db:migrate`
**не** можна вважати надійним підтвердженням застосування міграції в жодному
випадку — завжди перевіряй по факту (`\d <table>` / `__drizzle_migrations`
timestamp), незалежно від того, як команда була викликана.
Доказ: server/src/db/migrate.ts:37 (guard); перевірено 2026-08-11 —
`__drizzle_migrations` мав 14 рядків (найновіший 2026-08-03) і після
`pnpm db:migrate` лишився 14; зʼявився 15-й рядок (2026-08-11) лише після
прямого `runMigrations(process.env.DATABASE_URL)` з тимчасового скрипта

## 2026-08-11 · gotcha
**Коментар "the ONLY place that touches `repos`" у `repos/repository.ts` — це
аспіраційна, а не забезпечена правилом конвенція**
`RepoRepository`'s doc-comment (`server/src/modules/repos/repository.ts:7`)
каже "Every query is scoped by workspaceId... the ONLY place". На практиці
кілька інших модулів (`repo-intel/repository.ts`, `reviews/repository.ts`)
уже читають `t.repos` напряму зі свого власного `repository.ts` для
join'ів/лукапів — і це нормальна, прийнята практика (кожен модуль читає
чужу таблицю для власних потреб через СВІЙ repository-шар, а не через
сервіс іншого модуля). Новий `project-context/repository.ts` зробив те
саме (`getRepoForContext`). Не сприймай цей коментар як "потрібен
крос-модульний сервіс-виклик замість прямого читання" — це про write-шлях
(`add`/`clone`/`remove`), не про читання.
Доказ: server/src/modules/repos/repository.ts:7; прецеденти —
server/src/modules/repo-intel/repository.ts:136-148 (`getRepoBasics`),
server/src/modules/project-context/repository.ts (`getRepoForContext`)

## 2026-08-19 · gotcha
**GitHub's `pr_files.patch` уже містить свій `@@ ... @@`-заголовок хунка — бракує
лише file-level `diff --git`/`---`/`+++` рядків, не чотирьох заголовків**
При реконструкції unified diff з `pr_files.patch`+`.path` (SPEC-05 T6,
`POST /findings/:id/eval-case`) легко припустити, що `.patch` — це "голе тіло
хунка" без ЖОДНОГО заголовка, і завжди синтезувати `@@ -0,0 +1,<n> @@` собі. Але
реальний GitHub API (і мок `MockGitHubClient.getPullRequest`'s
`files[0].patch`) повертає рядок, що вже ПОЧИНАЄТЬСЯ з власного
`@@ -oldStart,oldLines +newStart,newLines @@` — те саме підтверджує наявний
`evals.it.test.ts`'s `DIFF`-фікстура, де `@@ -1,2 +1,5 @@` йде відразу після
синтетичних `---`/`+++` рядків. Правильна реконструкція: перевірити, чи
`.patch` вже починається з `@@ ... @@` (regex `/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/`)
— і синтезувати заголовок лише як fallback, коли його немає, а не завжди.
Доказ: server/src/adapters/mocks.ts:177 (`patch: '@@ -10,3 +10,4 @@\n...'`),
server/src/modules/evals/service.ts:409-415 (`reconstructSingleFileDiff`)

## 2026-08-19 · gotcha
**Заміна `matchFindings()`'s точного збігу множин на `scoreEvalCase()`'s
"нейтральна зона" (AC-7) тихо перевертає pass/fail існуючого інтеграційного
тесту, написаного під СТАРУ семантику**
`evals.it.test.ts`'s тест "with a corner-case skill linked+enabled..." навмисно
демонстрував, що ввімкнення скіла змінює результат прогону: зі старим
`matchFindings` (`expected=[]`, `actual=[1 finding]` → `pass=false`, бо
`actual.length !== expected.length`). Нова формула (SPEC-05 AC-7) трактує
знахідку поза ВСІМА розміченими зонами як нейтральну — не карає precision — тож
той самий сценарій (`expected_output: []`, тобто взагалі без зон) тепер дає
`pass=true`. Це не регресія, а навмисний наслідок формули з Goals спеки — але
дослівний старий assert (`traces_passed).toBe(0)`) ламається мовчки після
переходу на `scoreEvalCase()`, якщо його не оновити разом з T3/T4.
Доказ: server/src/modules/evals/helpers.ts:18-56 (`scoreEvalCase` doc-comment
з формулою), server/test/evals.it.test.ts (тест перейменовано й assert
змінено на `toBe(1)` з коментарем-поясненням)

## 2026-08-19 · gotcha
**Той самий `argv[1]`-guard баг, що вже задокументований для `migrate.ts`
(2026-08-11), ламає й `seed.ts` — `pnpm db:seed` теж мовчки нічого не робить**
`pnpm db:seed` (і прямий `tsx src/db/seed.ts`) завершується з exit 0, без
жодного виводу — ні `✓ seeded {...}`, ні помилки — і без жодного нового
рядка в БД. Причина та сама: CLI-guard `if (import.meta.url === file://
${process.argv[1]}) {...}` (`seed.ts:539`) ніколи не збігається в цьому клоні,
бо шлях репозиторію містить пробіл (`.../ai agent/dev-digest`). Через це весь
блок виклику `seed(handle.db)` просто не виконується — не лише сам
`console.log`, а взагалі жодна вставка. Перевірено фактично: `SELECT count(*)
FROM eval_cases` лишався `0` після "успішного" `pnpm db:seed`, і зʼявились 8
очікуваних рядків лише після прямого виклику `seed(handle.db)` з тимчасового
скрипта поза `argv[1]`-перевіркою (той самий workaround, що вже
задокументований для `runMigrations`). Висновок: у цьому репо жоден
скрипт з таким CLI-guard-паттерном (`db/migrate.ts`, `db/seed.ts`, і
ймовірно інші) не можна вважати таким, що справді щось зробив, лише за
exit code чи відсутністю помилки — завжди перевіряй по факту (`SELECT
count(*)` / `\d <table>`), як і для міграцій.
Доказ: server/src/db/seed.ts:538-539 (guard), server/src/db/seed.ts:548
(`console.log('✓ seeded', r)` — цей рядок не зʼявився в жодному прогоні
цієї сесії)
