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
