Коротко: ні service.ts, ні repository.ts окремо не покриють це один-в-один, тому що зараз у `server/src/modules/pulls/` взагалі немає ні того, ні іншого — весь код (і DB-доступ, і GitHub-виклики, і трансформації) зараз живе прямо в `routes.ts`. Це вже відхилення від конвенції модуля, описаної в `server/CLAUDE.md` (`routes.ts` + `service.ts` + `repository.ts`), і твоя фіча — гарний привід нарешті розділити шари, а не ще один привід дописати ще 20 рядків у `routes.ts`.

## Як розкласти

Розбий на дві різні речі, бо вони за своєю природою різні:

1. **Сам підрахунок diff stats (files changed / additions / deletions) з diff-блоба** — це чиста трансформація: вхід — рядки diff, вихід — три числа, без жодного I/O. Це не "дані" (не Drizzle-запит) і не "оркестрація" (не рішення "коли" це робити) — це обчислення. У модулі вже є точний прецедент для такого коду: `findings-summary.ts` з функцією `buildFindingsSummary()`, яка так само бере рядки з БД і чисто агрегує їх у `FindingsSummary`, без власних запитів. Онови той самий патерн — заведи `diff-stats.ts` поруч із `findings-summary.ts` з функцією типу `computeDiffStats(diffBlob: string): { files_count, additions, deletions }`. Це не `repository.ts`, бо не займається доступом до Postgres, і не `service.ts`, бо не приймає рішень про *коли* перерахувати — це чиста допоміжна функція, яку `service.ts` викликає.

2. **Оркестрація "при відкритті PR-detail — перерахувати і зберегти"** — це вже `service.ts`: прочитати збережений diff-блоб через репозиторій, викликати `computeDiffStats()`, записати результат назад через репозиторій. Це рішення бізнес-рівня ("recompute on reopen"), тож воно належить оркестраційному шару, а не `routes.ts` (який має лише перекладати HTTP ↔ виклик сервісу) і не `repository.ts` (який не повинен містити логіку "коли перераховувати").

Разом з цим варто виділити й `repository.ts` для суто Drizzle-доступу (читання PR + diff-блоба, `update` полів `additions`/`deletions`/`filesCount`) — за правилом skill'а "Data-access logic leaking into service.ts": сирі `db.select()/update()` не повинні жити просто в `service.ts`, а тим більше в `routes.ts`, де вони зараз і лежать (див. `routes.ts:249-259` — точно та ділянка, яку логічно чіпає твоя задача, вона й зараз пише `additions`/`deletions`/`filesCount` напряму з ендпоінта).

Підсумкова форма:

```
routes.ts     — GET /pulls/:id викликає service.getPrDetail(...)
service.ts    — orchestration: prReopened() → repo.getStoredDiff() → computeDiffStats() → repo.updateDiffStats()
repository.ts — Drizzle: getStoredDiff(prId), updateDiffStats(prId, stats)
diff-stats.ts — чиста функція computeDiffStats(diffBlob) — без I/O, поруч із findings-summary.ts
```

## Чи потрібно щось reviewer-core?

Ні. `reviewer-core/src/**` — це виключно пайплайн `diff → prompt → LLM → grounded findings` (див. `reviewer-core/README.md`): diff туди подається як вхід для промпта й для `groundFindings()` (перевірка, що знахідка цитує реальний рядок diff'а), а не для підрахунку статистики "скільки файлів/рядків змінено". Там немає жодної функції агрегації diff stats, і додавати її туди сенсу нема — `files_count`/`additions`/`deletions` це presentation-дані для списку/детейлу PR у `@devdigest/api`, які reviewer-core ніяк не споживає. Тримай `computeDiffStats()` локально в `modules/pulls/`, а не в спільному пакеті — його не використовує ніхто, крім цього модуля, тож немає підстав виносити його ні в `reviewer-core`, ні навіть у `@devdigest/shared`.

Єдине, за чим варто простежити (не про reviewer-core, а про сам diff-блоб): переконайся, що "recompute from stored diff blob" рахує з того самого diff, який реально зберігається/використовується для рев'ю (`prFiles`/`patch` у `db/schema.ts`), а не дублює логіку GitHub-бекфілу, яка вже є в `routes.ts:92-119` і `routes.ts:249-259` — там diff stats уже підтягуються з GitHub API (`detail.additions/deletions/files_count`) при кожному відкритті detail-сторінки, коли є токен. Якщо мета — саме "перерахувати з локально збереженого diff-блоба, без нового виклику GitHub" (наприклад, офлайн-fallback або коли GitHub недоступний), онови той `catch`-блок (`routes.ts:262-294`) — там зараз просто віддається персистована `additions/deletions/filesCount` без перерахунку, і саме туди логічно підключити виклик `service`-методу.
