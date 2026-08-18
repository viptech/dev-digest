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
**`upstream/l06-evals` (курсовий template-репозиторій) відрізаний від старого чекпоінту — прямий `git merge` знищив би L02–L05**
`git diff --stat HEAD upstream/l06-evals` показав 533 файли, 82061 видалення:
гілка не має `.claude/agents/`, `.claude/plans/`, кількох скілів
(`workflow-retro`, `sdd-implement`, `react-ui-architecture`, `pr-self-review`)
і половини `server/` (модулі `skills`, `smart-diff`, контракти
project-context). Це не активне видалення з боку upstream — гілку просто
відрізали від репозиторію до того, як ці лесони приземлились локально. Пряме
`git merge upstream/l06-evals` спробувало б реконсилювати це як реальні
зміни. Робочий обхід — переносити лише конкретний новий каталог окремим
комітом: `git checkout upstream/l06-evals -- evals` (жодного full-branch
merge), точно за фолбеком, який описує сама лаба.
Доказ: `04-hands-on-lab.md` (L06, "Якщо merge конфліктує з версією
репозиторію, каталог переносять окремим комітом")

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
