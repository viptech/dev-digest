# INSIGHTS — крос-модульне та інфраструктура

Знахідки, що не належать одному модулю: спільні контракти, `scripts/`, CI,
Docker, тулінг репозиторію. Append-only — див.
[`.claude/skills/engineering-insights`](.claude/skills/engineering-insights/SKILL.md).

---

## 2026-07-28 · gotcha
**`skills-lock.json` описує лише вендорені скіли — локальні туди не додаються**
Кожен запис має реальний `source` на GitHub і `computedHash` для перевірки
цілісності. Локально написаний скіл апстріму не має, тож запис із синтетичним
джерелом зламає перевірку. Локальні скіли живуть у `.claude/skills/` поза
lock-файлом.
Доказ: skills-lock.json:5

## 2026-07-28 · gotcha
**Симлінк `.cursor/skills/` задокументований, але в репозиторії його немає**
README каталогу скілів обіцяє `.cursor/skills/ → ../.claude/skills` для
сумісності з Cursor. Фактично теки `.cursor` не існує — Cursor скіли не підхопить,
доки симлінк не створять руками.
Доказ: .claude/skills/README.md:3

## 2026-07-28 · gotcha
**pnpm блокує `pnpm exec`/`pnpm run <script>` без інтерактивного підтвердження build-скриптів — і це стається в КОЖНОМУ pnpm-пакеті репо**
`pnpm exec drizzle-kit generate` (і будь-яка інша команда, що йде через
`pnpm exec`/`pnpm <script>`) валиться з `ERR_PNPM_IGNORED_BUILDS`, бо pnpm
спершу прогонює прихований `pnpm install` для перевірки залежностей, а той
впирається в неапрувнуті build-скрипти (esbuild, sharp, cpu-features, ...) і
чекає на `pnpm approve-builds`, якого в неінтерактивній сесії ніхто не дасть.
Обхід: викликати бінарник напряму, минаючи pnpm-обгортку —
`node node_modules/<pkg>/bin.cjs ...` (напр. `node node_modules/drizzle-kit/bin.cjs generate`)
або `node_modules/.bin/tsc`/`node_modules/.bin/vitest` замість `pnpm exec`.
Доказ: server/package.json:14 (`"db:generate": "drizzle-kit generate"`)

## 2026-07-28 · gotcha
**Testcontainers (`.it.test.ts`) можуть зависати на 120с навіть коли `docker info` успішний**
`dockerAvailable()` перевіряє лише `docker info`, але фактичний запуск
контейнера через testcontainers-node — окремий шлях, який у пісочниці агента
може підвисати на hook timeout, а не чисто скіпатись. Якщо `.it.test.ts` висять
на таймауті замість очікуваного skip/pass — спробуй прогін з вимкненим
пісочним обмеженням інструменту Bash, перш ніж робити висновок про поламаний код.
Доказ: server/test/helpers/pg.ts:23,36

## 2026-07-31 · gotcha
**`server/src/vendor/shared` і `client/src/vendor/shared` — дві фізично окремі, git-tracked копії контрактів `@devdigest/shared`, без симлінка чи sync-скрипта**
`client/tsconfig.json` мапить аліас `@devdigest/shared` на
`./src/vendor/shared/index.ts` — власну копію клієнта, а не на серверний пакет.
Коміт `5ce9475` ("feat(pulls-api): add per-PR findings_summary...") додав
`findings_summary`/`FindingsSummary`/`FindingsSummaryItem` лише в
`server/src/vendor/shared/contracts/platform.ts`, не торкнувшись клієнтської
копії — хоча план (task-4-brief) стверджував, що тип уже "flows through" до
клієнта. Реально `pnpm typecheck` у client валився з
`Property 'findings_summary' does not exist` доки я вручну не портував той
самий diff у `client/src/vendor/shared/contracts/platform.ts`. Попередній
коміт `91263c0` ("feat(reviews): show run cost...") оновлював ОБИДВІ копії
разом — тобто дублювання навмисне й відоме, але однопакетний таск-бриф це
легко проґавлює. Перевіряй обидві копії при будь-якій зміні контракту.
Доказ: server/src/vendor/shared/contracts/platform.ts:158-201 vs
client/src/vendor/shared/contracts/platform.ts (до фіксу цього ж дня не мав
`findings_summary` взагалі)

## 2026-08-11 · gotcha
**Порядок секцій у `.claude/agents/README.md` — не алфавітний, а конвеєрний**
Секції йдуть у порядку хендофу (`researcher` → `implementation-planner` →
`implementer` → `test-writer` → `architecture-reviewer` → `plan-verifier` →
`doc-writer`), як описано в секції "Хендоф" унизу того ж файлу, і збігається
з порядком у заголовку `docs/claude-code-agents.md:1`. При перейменуванні чи
додаванні агента зберігай його позицію в конвеєрі — не "виправляй" на
алфавітний порядок (я спершу помилково запланував саме це при перейменуванні
`planner.md` → `implementation-planner.md`, довелось відкотити рішення після
повторного читання файлу).
Доказ: .claude/agents/README.md:200-211


## 2026-08-18 · gotcha
**`skill-creator`'s `scripts/aggregate_benchmark.py` тихо занулює tokens і ігнорує описово названі eval-теки — обидва без жодного попередження**
Два незалежні дефекти зловлені під час Експерименту 1 (L06, скіл `zod`, 2
кейси × with/without × 2 прогони):
(1) Виявлення eval-тек читає буквально `benchmark_dir.glob("eval-*")` —
тека з описовою назвою (`user-profile-route-review/`), яку сам SKILL.md
скіла прямо радить використовувати ("Give each eval a descriptive name...
not just eval-0"), просто пропускається з "No eval directories found" без
іншого попередження. Обхід — префіксувати описову назву `eval-N-`
(`eval-1-user-profile-route-review`) — реальний `eval_id` все одно береться
з `eval_metadata.json`, префікс потрібен лише для glob'а.
(2) Токени рахуються ЛИШЕ з сусіднього `timing.json`, і лише якщо
`result["time_seconds"] == 0.0` — якщо `grading.json` сам містить
`"timing": {"total_duration_seconds": ...}` (а `agents/grader.md`'s Step 8
прямо радить туди скопіювати timing.json), гілка з токенами взагалі не
виконується і всі прогони показують `tokens: 0` без жодного попередження.
Обхід — не класти `total_duration_seconds` всередину `grading.json`, лишати
timing-дані тільки в сусідньому `timing.json`.
Доказ: `~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator/scripts/aggregate_benchmark.py:86-152`

## 2026-08-19 · gotcha
**`Bash`-тул відсутній у сесії `implementer`-агента з самого початку (SPEC-05
T13) — не "стався збій", а взагалі не був у списку доступних інструментів**
Задача прямо попереджала, що це вже траплялось двічі раніше в цьому ж плані
("both times caught and fixed by the coordinator running tests manually") —
підтверджено втретє: у списку `functions` цієї сесії був лише
`Read/Edit/Write/Skill/Grep/Glob`, без `Bash`. Наслідок — неможливо виконати
`pnpm typecheck`/`pnpm test`/`pnpm run verify:l06`, і неможливо фізично
перемістити/видалити файли (немає інструменту видалення) — довелось лишити
старий `EvalCaseModal`-каталог (`client/src/app/agents/[id]/_components/
AgentEditor/_components/EvalsTab/_components/EvalCaseModal/`) осиротілим
замість справжнього `mv`, коли компонент промотили в
`client/src/components/eval-case-modal/`. Правило: щойно виявив відсутність
`Bash` у списку інструментів — одразу зафіксувати це в звіті координатору
(а не намагатись "симулювати" typecheck вручну чи мовчки обходити відсутність
видалення файлів) — так само, як цей запис.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`), задача-промпт
секції "Run the full test suite afterward... this has happened twice before"

## 2026-08-19 · gotcha
**Відсутність `Bash` у сесії `implementer` для SPEC-05-евалів — не разовий
збій, а системне: підтверджено ЧЕТВЕРТИЙ раз, на іншому плані того ж
"сімейства" (`evals-tab-mockup-alignment.md`)**
Продовжує запис вище (2026-08-19, "втретє") — цього разу для окремого,
пізнішого плану (`.claude/plans/evals-tab-mockup-alignment.md`, той самий
`EvalsTab`/`eval-dashboard` кут кодової бази), і знову список `functions`
сесії містив лише `Read/Edit/Write/Skill/Grep/Glob`, без `Bash`. Візерунок:
проблема прив'язана не до конкретного плану чи задачі, а до того, ЯК
координатор запускає `implementer`-агента для цієї гілки роботи (evals/
SPEC-05) — варто перевірити конфігурацію дозволів інструментів для цього
конкретного ланцюжка агентів, а не List кожен раз як окремий інцидент.
Наслідок для виконавця: імплементація (Read/Edit/Write) пройшла повністю, але
`pnpm test`/`pnpm typecheck` в `client/` та `pnpm exec vitest run` в `server/`
не були запущені цією сесією — координатор/наступна сесія має прогнати їх
вручну перед тим, як вважати роботу підтвердженою.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`); той самий
симптом задокументовано вище для іншого плану того ж SPEC-05 evals-треку.

## 2026-08-20 · gotcha
**Існує ТРЕТЯ, задокументована лише коментарем копія `FEATURE_MODELS` —
`client/src/lib/feature-models.ts` — окремо від вже відомого dual-copy
`vendor/shared` (запис 2026-07-31), і вона вже розійшлась зі значеннями**
Крім `server/src/vendor/shared/contracts/platform.ts` і
`client/src/vendor/shared/contracts/platform.ts` (типова dual-copy пара),
`client/src/lib/feature-models.ts` тримає ЩЕ ОДНУ ручну копію самого масиву
`FEATURE_MODELS` — власний коментар файлу пояснює чому: імпорт `vendor/shared`
як RUNTIME-значення (не типу) тягне `vendor/shared/index.ts` у webpack-бандл,
чиї `./contracts/*.js` реекспорти Next не резолвить, тож масив довелось
продублювати вручну (`client/src/lib/feature-models.ts:1-11`). Ця третя копія
вже розійшлась ДО цієї сесії: `review_intent` тут має `defaultProvider:
'openai'`/`defaultModel: 'gpt-4.1'` (`client/src/lib/feature-models.ts:21-27`),
тоді як обидві копії `vendor/shared` мають `'openrouter'`/
`'deepseek/deepseek-v4-flash'`; `conventions` тут має `'openai'`/`'gpt-5.4'`
(`client/src/lib/feature-models.ts:42-48`) проти `'openrouter'`/
`'deepseek/deepseek-v4-flash'` в обох `vendor/shared`. Ця сесія (SPEC-06 T6,
план skill-editor.md Step 1) додала новий `FeatureModelId` `'skill_eval'` +
відповідний запис `FEATURE_MODELS` в ОБИДВІ копії `vendor/shared`
(`server/src/vendor/shared/contracts/platform.ts`,
`client/src/vendor/shared/contracts/platform.ts`), але НЕ торкнулась
`client/src/lib/feature-models.ts` — поза обсягом server-only кроку. Тип
`FeatureModelId` реекспортується з `vendor/shared` і лишається синхронним
автоматично, а `FEATURE_MODELS`-МАСИВ — ні: наступний, хто торкнеться
`client/src/app/settings/[section]/_components/SettingsView/_components/SettingsModels/SettingsModels.tsx`
(яка читає саме цю третю копію,
`SettingsModels.tsx:9-10`), мусить додати туди `'skill_eval'` вручну — інакше
нова фіча мовчки не з'явиться в Settings UI, без жодного падіння typecheck чи
тесту.
Доказ: client/src/lib/feature-models.ts:1-11,21-27,42-48;
client/src/app/settings/[section]/_components/SettingsView/_components/SettingsModels/SettingsModels.tsx:9-10

## 2026-08-22 · gotcha
**Відсутність `Bash` у сесії `implementer` — підтверджено ще і для ТРЕТЬОГО,
незалежного плану (`multi-agent-review.md`, SPEC-07), поза "сімейством"
evals/SPEC-05, яке вже фіксували два записи від 2026-08-19**
Ті записи припускали, що проблема прив'язана саме до "цієї гілки роботи
(evals/SPEC-05)". Ця сесія (Implementer 1 — Contracts + DB, план
`.claude/plans/multi-agent-review.md`) — зовсім інший план, інший таск-бриф,
інший координатор-виклик — і знову список `functions` містив лише
`Read/Edit/Write/Skill/Grep/Glob`, без `Bash`. Висновок сильніший, ніж
попередній: це не особливість конкретного ланцюжка агентів (evals), а
систематична поведінка ЦЬОГО типу дочірньої сесії (`implementer`, викликаний
з написаного плану) незалежно від теми плану. Наслідок для цього конкретного
плану: T2 (`node node_modules/drizzle-kit/bin.cjs generate` + `pnpm
db:migrate`) і крок 3 (`pnpm typecheck`) НЕ були виконані цією сесією — лише
Read/Edit-частина (contracts + `db/schema/runs.ts`) готова; координатор
мусить сам згенерувати міграцію і прогнати typecheck, а не вважати ці кроки
підтвердженими.
Доказ: system prompt цієї сесії (`<functions>`-блок без `Bash`); попередні
підтвердження — root INSIGHTS.md, записи 2026-08-19 (двічі, для evals/SPEC-05)

## 2026-08-22 · gotcha
**Додавання нового `.nullable()` (НЕ `.optional()`) поля до спільного
zod-контракту в `vendor/shared` ламає typecheck у КОЖНОМУ пакеті, що імпортує
той самий тип для типізованого fixture-builder'а — не лише в пакеті, що
"власник" зміни**
`RunSummary.multi_agent_run_id: z.string().nullable()` (нове поле, SPEC-07 T1)
є REQUIRED у виведеному TS-типі (просто `string | null`, не
`string | null | undefined`) — тож будь-який літерал, явно типізований як
`RunSummary` (fixture-builder з дефолтами + `...overrides`), мусить явно
включати поле, інакше `tsc` кричить "Property is missing", НЕЗАЛЕЖНО від
того, парситься об'єкт через zod чи ні (це компіляційна, а не рантайм-помилка,
на відміну від запису 2026-08-03 про required-поля в `.parse()`-фікстурах).
Знайдено одразу в трьох місцях, з яких лише одне (server) було в "Modules
involved" плану: `server/src/modules/brief/service.test.ts` (власний
пакет), `client/.../RunHistory/RunHistory.test.tsx` (інший пакет, той самий
тип через client-копію `vendor/shared`), і
`mcp-server/test/support/fixtures.ts` +
`mcp-server/test/tools/run-agent-on-pr.test.ts` (ТРЕТІЙ пакет, зовсім поза
"Modules involved" плану й поза `TESTING.md` — `mcp-server/tsconfig.json:14`
аліасить `@devdigest/shared` прямо на серверну копію, тож серверна правка
дiстає його типчек безкоштовно). Перевіряй `grep -rn "<TypeName>" .` по
ВСЬОМУ репо (не лише всередині "Modules involved" плану), коли додаєш
non-optional поле (nullable чи ні) до спільного контракту — package-scoped
grep пропустить сусідні пакети, що теж імпортують ту саму `vendor/shared`
копію.
Доказ: server/src/vendor/shared/contracts/trace.ts (`multi_agent_run_id:
z.string().nullable()`); mcp-server/tsconfig.json:14 (`"@devdigest/shared":
["../server/src/vendor/shared/index.ts"]`)
