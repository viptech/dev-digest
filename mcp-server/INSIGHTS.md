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
