# INSIGHTS — mcp-server (`@devdigest/mcp-server`)

Знахідки по локальному MCP-серверу (5 tools над DevDigest API). Append-only —
див. [`.claude/skills/engineering-insights`](../.claude/skills/engineering-insights/SKILL.md).

---

## 2026-08-06 · gotcha
**MCP SDK's `CallToolResult` — "loose" zod-об'єкт: іменований TS-тип для
`structuredContent`/власного error-результату мусить явно мати `[key: string]:
unknown`, інакше `tsc` падає навіть при повній структурній сумісності**
`@modelcontextprotocol/sdk` (1.30.0) генерує `CallToolResult` з zod-схеми в
режимі `z.core.$loose` (zod 3.25.76 вже несе v4-подібний `z.core`) — це додає
index signature до інферованого TS-типу. Свіжий інлайн-об'єктний літерал
(`return {content:[...], structuredContent: {...}}` без проміжної змінної з
явною анотацією типу) не страждає — TS перевіряє його як "fresh" літерал.
Але щойно результат проходить через named interface/тип (`ToolErrorResult`,
`ShapedFindings`), він втрачає freshness, і TS вимагає, щоб цей тип теж мав
`[key: string]: unknown` — інакше "Index signature for type 'string' is
missing in type 'X'", хоча всі відомі поля структурно збігаються.
Доказ: mcp-server/src/errors.ts (`ToolErrorResult`), mcp-server/src/tools/get-findings.ts
(`ShapedFindings`), node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:2501
(`CallToolResultSchema: z.ZodObject<{...}, z.core.$loose>`)

## 2026-08-06 · gotcha
**Реєстрація кількох `server.registerTool()` у циклі по гетерогенному масиву
ламає generic-інференцію SDK, навіть якщо кожен tool окремо валідний**
П'ять `create*Tool()` повертають структурно різні типи (різні Zod
input/output shapes на кожен tool). `const tools = [a,b,c,d,e]; for (t of
tools) server.registerTool(t.name, t.config, t.handler)` widen-ить елементи
масиву до спільного типу, і TS видає незрозумілу помилку типу "outputSchema
одного тула не збігається з іншим" у зовсім невідповідному місці. Рішення:
реєструвати кожен tool окремим явним викликом, без циклу.
Доказ: mcp-server/src/index.ts (5 окремих `server.registerTool(...)`)

## 2026-08-06 · gotcha
**Контракт `PrMeta.id` — `z.string().nullish()`, навіть для internal UUID
пула, який на практиці завжди присутній після резолву через `GET
/repos/:id/pulls`**
Код, що споживає `PrMeta` і потребує гарантованого `string` (напр. передає
`pull.id` у функцію, що очікує невід'ємний UUID для polling), не може
покладатись на "це завжди буде рядок" — `tsc` справедливо це ловить.
Розв'язано явним звуженням у резолвері: якщо `match.id` відсутній, кинути
`ResolutionError`, а не пропускати `null`/`undefined` далі.
Доказ: server/src/vendor/shared/contracts/platform.ts:190
(`id: z.string().nullish()`), mcp-server/src/resolvers.ts (`resolvePull`
повертає `PrMeta & {id: string}`, кидає `ResolutionError` якщо `id` відсутній)

## 2026-08-06 · gotcha
**Будь-який REST-клієнт `IdParams`-роутів (не лише тест) отримає 422, а не
404, на синтаксично невалідний (не-UUID) `:id` — і має мапити обидва статуси
на те саме "не знайдено"**
`server/INSIGHTS.md`'s запис від 2026-08-06 про `IdParams` описує це з
погляду тестів (`app.inject()` з UUID-подібним "невідомим" id). Той самий
факт має клієнтський наслідок: `get_findings(run_id)` спершу мапив лише
`status === 404` на дружнє повідомлення — виклик із будь-яким
не-UUID-подібним (напр. галюцинованим) `run_id` протікав сирим `"DevDigest
API request failed with status 422"` назовні, порушуючи "помилка веде
далі". Підтверджено живим smoke-тестом проти реального сервера
(`run_id: 'not-a-real-run-id'` → 422). Виправлено мапінгом і 404, і 422 на
однакове forward-leading повідомлення — з погляду викликача малформований і
неіснуючий `run_id` однаково "тут нічого немає".
Доказ: server/src/modules/_shared/schemas.ts:11 (`IdParams = z.object({id:
z.string().uuid()})`), mcp-server/src/tools/get-findings.ts (catch-гілка
`err.status === 404 || err.status === 422`)

## 2026-08-06 · gotcha
**`claude mcp add`/`add-json` не дають надійного способу задати `cwd` для
stdio-сервера — `tsx` резолвить `tsconfig.json`'s `paths`-аліас відносно
робочої директорії процесу, а не місця entry-файлу**
`claude mcp add` не має прапорця `--cwd` взагалі. `claude mcp add-json` з
полем `"cwd": "..."` у JSON приймається без помилки, але поле мовчки
зникає — перевірено читанням збереженого конфіга `~/.claude.json` після
`add-json` з `cwd`: поля там немає. Наслідок: коли Claude Code сам спавнить
`tsx src/index.ts` (без `cwd` = робоча директорія лишається кореневою
директорією репо, а не `mcp-server/`), `tsx` не знаходить
`mcp-server/tsconfig.json`'s alias `@devdigest/shared` → падає з
`ERR_MODULE_NOT_FOUND: Cannot find package '@devdigest/shared'`, а MCP-клієнт
показує лише загальне `-32000: Connection closed` — жодного натяку, що
причина саме в cwd. Рішення: `start.sh`, що сам робить `cd
"$(dirname "$0")"` перед запуском `tsx` — працює однаково незалежно від cwd
викликача.
Доказ: mcp-server/start.sh, mcp-server/tsconfig.json (`paths` alias),
відтворено напряму: `node_modules/@modelcontextprotocol/sdk/.../client/stdio.js`
кидає `-32000` при закритті child-процесу, який усередині падає з
`ERR_MODULE_NOT_FOUND` (видно лише в stderr child-процесу, не в помилці MCP-клієнта)

## 2026-08-06 · measured
**Живий end-to-end `run_agent_on_pull_request` (repo=acme/payments-api, PR
#482, agent="General Reviewer", реальний LLM-виклик через
openrouter/deepseek) завершився значно швидше за 60-секундний poll-бюджет**
Жодного разу не спостережено fallback-гілку `{status:"running"}` у ручному
smoke-тестуванні одного single-pass прогону на невеликому PR. Не доказ, що
60с достатньо для map-reduce strategy на великому діффі — лише підтверджує,
що бюджет із запасом для типового випадку.
Доказ: mcp-server/src/tools/run-agent-on-pull-request.ts:25
(`POLL_TIMEOUT_MS = 60_000`), ручний прогін через MCP SDK `Client` +
`StdioClientTransport` проти живого `http://localhost:3001`

## 2026-08-07 · decision
**Спростовує дизайн-рішення від 2026-08-06 (owner/name + PR-номер + agent-name,
з client-side резолвом): 3 з 5 тулів переписані на прямі id (`agent_id`,
`pr_id`, `repo_id`) — саме такий контракт вимагає сценарій курсу для MCP
Inspector**
Файл `mcp-server/src/resolvers.ts` (client-side резолв "owner/name"/PR-номера/
agent-name → internal UUID через `GET /repos`+`GET /repos/:id/pulls`+
`GET /agents`) і його тест повністю видалені — жоден з 5 тулів більше не
резолвить назви, кожен приймає готовий id. `run_agent_on_pull_request` →
`run_agent_on_pr(agent_id, pr_id)`, `get_conventions(repo)` → `get_conventions
(repo_id)`, `get_blast_radius(repo, pr)` → `get_blast_radius(pr_id)`. Записи
вище (2026-08-06, "PR identification", "Agent resolution key",
`resolvePull`'s `PrMeta.id` gotcha) описують СТАРИЙ дизайн — файли, на які
вони посилаються (`resolvers.ts`, `run-agent-on-pull-request.ts`), більше не
існують; лишені як історичний запис, не як актуальна довідка.
Доказ: mcp-server/src/tools/run-agent-on-pr.ts, mcp-server/src/tools/
get-conventions.ts:29-32 (`repo_id: z.string().trim().min(1)`),
mcp-server/src/tools/get-blast-radius.ts:15-18 (`pr_id` only) — `git log
--diff-filter=D -- mcp-server/src/resolvers.ts` показує видалення

## 2026-08-07 · gotcha
**`get_findings(pr_id)` мусив читати `GET /pulls/:id/reviews`, а не новий
`GET /runs/:id/findings` з 2026-08-06 — перший УЖЕ повертає "знахідки,
згруповані по прогонах", другий віддає лише один прогін за `run_id`**
`ReviewService.reviewsForPull` вже реалізує рівно ту форму відповіді, яку
вимагає сценарій лабораторної ("get_findings приймає pr_id, повертає знахідки
згруповані по reviews, не єдиним плоским списком") — масив `ReviewDto[]`, по
одному запису на кожен агент/прогін. `GET /runs/:id/findings` (доданий
2026-08-06 саме під run_id-варіант `get_findings`) лишається корисним
внутрішньо — `run_agent_on_pr` викликає його одразу після старту ОДНОГО
конкретного прогону, де `run_id` вже відомий — але для самого `get_findings`
це була не та форма.
Доказ: server/src/modules/reviews/routes.ts:166-169 (`GET /pulls/:id/reviews`),
server/src/modules/reviews/service.ts:208-221 (`reviewsForPull`),
mcp-server/src/tools/get-findings.ts (`http.get(`/pulls/${pr_id}/reviews`)`)

## 2026-08-07 · gotcha
**`ConventionsService.list()` не перевіряє існування репо — синтаксично
валідний, але неіснуючий `repoId` мовчки повертає `[]`, невідрізненне від
"репо є, конвенцій ще нема"; окремого `GET /repos/:id` теж нема**
`conventions/service.ts`'s `list()` одразу йде в `repo.listByRepo(...)` без
перевірки, чи існує репо в цьому workspace — на відміну від `reviewsForPull`
(яка кидає `NotFoundError`, якщо `pull` не знайдено). У `repos/routes.ts` є
лише `GET /repos` (список), `POST /repos`, `POST /repos/:id/refresh` — жодного
single-repo GET. Щоб зберегти гарантію "невідомий id → зрозуміла помилка",
`get_conventions`-тул спершу листить `GET /repos` і сам звіряє `repo_id` у
списку, перш ніж іти в `/repos/:id/conventions`.
Доказ: server/src/modules/conventions/service.ts:34-37 (`async list` — без
`NotFoundError`), server/src/modules/repos/routes.ts (немає `GET /repos/:id`),
mcp-server/src/tools/get-conventions.ts:57-65 (client-side перевірка через
`GET /repos`)

## 2026-08-07 · gotcha
**Юніт-тест тула, що викликає `tool.handler(...)` напряму, обходить
zod-парсинг вхідної схеми MCP SDK — перевірка `.trim()`/coercion на рівні
схеми такого виклику не бачить**
`server.registerTool(name, config, handler)` сам парсить аргументи через
`config.inputSchema` ПЕРЕД викликом `handler` — у реальному використанні
`handler` ніколи не бачить непідрізаний рядок. Прямий виклик
`tool.handler({repo_id: '  repo-1  '})` у тесті це обходить: `handler` не
робить власного trim, тож такий тест нічого не перевіряє (спостережено як
провальний тест: `expected true to be undefined` — бо репо з пробілами в id
не знайшлось). Правильна перевірка — парсити саму схему:
`z.object(getConventionsInputSchema).parse({repo_id: '  repo-1  '})`.
Доказ: mcp-server/src/tools/get-conventions.ts:29-32 (`repo_id:
z.string().trim().min(1)`), mcp-server/test/tools/get-conventions.test.ts
(тест "input schema trims..." парсить схему напряму, не через `tool.handler`)

## 2026-08-07 · decision
**Додано 6-й тул, `list_pulls(repo_id)` — лабораторна свідомо не додає
`list_prs`, але це рішення не покриває внутрішній `pr_id`, який реально
потрібен решті тулів**
`04-hands-on-lab.md:22`'s аргумент ("`gh`/GitHub MCP вже дають список PR")
вірний лише для GitHub-ідентичності PR (`owner/repo#number`) — жоден з них не
знає внутрішній DevDigest `pr_id` (UUID з таблиці `pull_requests`), який
вимагають `run_agent_on_pr`/`get_findings`/`get_blast_radius`. Без окремого
тула єдиний спосіб дістати `pr_id` — вручну відкрити Studio UI, навіть якщо
агент уже знає (напр. від GitHub MCP), що PR існує. `list_pulls` навмисно
тонкий: жодної фільтрації за назвою/автором, жодного `list_repos` (та частина
аргументу лабораторної й далі актуальна) — лише `GET /repos/:id/pulls` +
опційний `open_only` (відкидає `merged`/`closed`). Живою перевіркою через
Inspector CLI підтверджено: `list_pulls(repo_id, open_only=true)` на
`viptech/dev-digest` коректно відфільтрував 2 змерджені PR, лишивши 4 зі
статусами `needs_review`/`reviewed`/`stale`.
Доказ: mcp-server/src/tools/list-pulls.ts, mcp-server/src/index.ts (6-й
`server.registerTool`), server/src/modules/pulls/status.ts (`status` —
derived review-freshness для відкритих PR, не сире GitHub-значення)
