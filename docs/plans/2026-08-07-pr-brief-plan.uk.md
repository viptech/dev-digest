# PR Brief (фіча з L05, перенесена наперед) поверх Blast Radius (L04)

> Це **затверджений план реалізації**, збережений для довідки до виконання —
> не ретроспективний запис. Джерело: `.claude/plans/mellow-humming-wolf.md`.
> Англомовна версія лежить поруч: `2026-08-07-pr-brief-plan.md`.

## Контекст

Макет для сторінки Overview показує три речі понад уже реалізований Blast
Radius: (1) картку "PR BRIEF" зверху — вердикт, кількість знахідок/блокерів,
синтезований абзац тексту, кругову шкалу PR-оцінки та рядок вартості/токенів;
(2) двоколонкову сітку, де наявна картка Intent отримує секцію "Risk Areas" і
розташовується поруч із наявною карткою Blast Radius (зараз обидві просто
йдуть одна під одною на всю ширину); (3) футер "Prior PRs touching these
files" усередині картки Blast Radius. Це явно належить до обсягу **L05**
курсу (кореневий `README.md:86`: "PR Brief card"), а не L04 — користувач
вирішив перенести це наперед і зробити зараз.

Два рішення, які користувач прийняв явно, побачивши компроміси:

1. **Risk Areas і прозовий summary генеруються через LLM** (варіант A) — через
   `risk_brief` FeatureModelId, який уже зареєстрований у реєстрі
   `FEATURE_MODELS` в `server/src/vendor/shared/contracts/platform.ts`
   ("Assesses merge risks for a pull request", дефолтна модель
   `openai/gpt-4.1"), але не має **жодного викликача ніде** — цей план додає
   першого. Це реальний, кешований, request-time виклик LLM, а не евристика —
   йому потрібна та сама дисципліна захисту від injection, що й у кожному
   іншому LLM-виклику в цій кодовій базі.
2. **Блок "Prior PRs touching these files" робимо зараз теж** — детермінований
   SQL self-join, без LLM.

**Що лишається детермінованим, і чому (не дозволяти цьому зсуватись у бік
"модель вирішує"):** вердикт, оцінка та кількість блокерів/знахідок на рівні
PR обчислюються з уже персистентних, уже коректно gate-фільтрованих даних
(`agent_runs.blockers`, кількість знахідок), ніколи не з LLM. Це віддзеркалює
рішення, яке ця кодова база вже приймала один раз: `reviewer-core/src/review/reduce.ts`
та `to-review.ts` уже перекривають *самооголошені* моделлю вердикт/оцінку
детермінованим перерахунком з grounded-знахідок, саме тому що самооголошені
значення "пливуть і дивують". Відмивання того самого типу самозвіту в
крос-агентний бейдж рівня PR повернуло б ту саму проблему, яку кодова база
вже одного разу розв'язала. Лише **прозова розповідь** і **пункти ризиків** —
якісні, не gate-рішення — проходять через новий LLM-виклик.

## Бекенд: новий модуль `server/src/modules/brief/`

Дзеркалить форму `blast/` (`routes.ts` + `service.ts`), плюс цього разу
`repository.ts` (потрібен для кешу результату LLM) і `risk-brief.ts` для
промпту/виклику LLM, винесений окремо від `service.ts` заради тестованості.

### 1. Детермінований rollup рев'ю (без LLM)

**Джерело**: `container.reviewRepo.reviewsForPull(prId)` (наявний метод,
`server/src/modules/reviews/repository/review.repo.ts`), відфільтрований до
`kind==='review'`, **дедуплікований до останнього на агента** (нова, невелика,
чиста функція — сортувати від найновішого (запит уже так впорядкований),
лишити перший рядок на кожен `agentId`; рев'ю з `agentId===null` ніколи не
зливається з іншим). Це узагальнює той самий патерн "найновіше спершу, перше
знайдене перемагає", який уже використовується глобально для PR у
`server/src/modules/pulls/routes.ts:135-138`, лише ключем тут є `agentId`
замість `prId`.

Для кожного рядка, що вижив, приєднуємо його рядок `agent_runs` (через
`review.runId`) заради `blockers`, `findingsCount`, `tokensIn`, `tokensOut`.

- **Вердикт**: `blockers_total > 0 → request_changes`; інакше
  `findings_total > 0 → comment`; інакше `approve`. (`blockers_total`/
  `findings_total` = сума `blockers`/`findingsCount` по набору
  останніх-на-агента.) Це віддзеркалює власне обчислення event на рівні
  одного прогону в `reviewer-core/src/output/to-review.ts`, узагальнене на
  кілька агентів — ніколи не читає `reviews.verdict` (ця колонка — власний
  самозвіт моделі, за `reduce.ts`, і їй явно не можна довіряти для цього).
- **Оцінка**: **найнижча оцінка** серед набору останніх-на-агента (tie-break:
  найновіший `createdAt`). Свідомо не середнє (могло б сховати провал одного
  агента за чистими оцінками інших) і не "останній прогін" (це вже робить
  наявне поле `score` у списку PR — те поле лишаємо як є; оцінці в Brief
  дозволено відрізнятись від оцінки в списку, і це варто позначити
  однорядковим коментарем у коді, щоб пізніше це не виглядало випадковою
  неузгодженістю).
- **Суми блокерів/знахідок**: прямі суми вже персистентних
  `agent_runs.blockers`/`findingsCount` кожного рядка, що вижив — не свіжий
  пул-перерахунок (це вимагало б `ci_fail_on` саме того агента, що знайшов
  кожну знахідку, а це вже коректно закодовано в колонці на рівні прогону).
  Дублікати знахідок між агентами не дедуплікуються — це узгоджено з тим, як
  `page.tsx` уже обчислює загальний бейдж знахідок сьогодні
  (`runs.flatMap(r => r.findings).length`).
- **Вартість/токени**: **інший, ширший** набір рядків, ніж вище — кожен рядок
  `agent_runs` за всю історію PR (віддзеркалює наявну суму `cost_usd` у
  `pulls/routes.ts:159-173`, чий власний коментар каже "кожен прогін рев'ю, а
  не лише останній" — гроші були витрачені і на відкинуті повторні прогони
  теж). Розширити той самий блок запиту `sum(tokensIn)`/`sum(tokensOut)`.
  Чітко закоментувати, що вартість/токени та блокери/знахідки навмисно
  читаються з двох різних наборів рядків, щоб хтось пізніше не "спростив" це
  в один запит і мовчки не змінив значення одного з чисел.
- **Випадок null**: нуль рядків `kind==='review'` → `review_rollup: null`
  (віддзеркалює `PrIntentRecord | null`). Ризики/prior-PRs все одно
  обчислюються незалежно від цього.

Новий чистий файл: `server/src/modules/brief/rollup.ts` (`latestReviewPerAgent`,
`computeVerdict`, `pickLowestScore`) — без I/O, тестується на фікстурах.

### 2. Risk Areas + summary — новий виклик LLM

**Новий файл `server/src/modules/brief/risk-brief.ts`**, структурований точно
як `classify()` в `server/src/modules/reviews/intent-service.ts` (та сама
форма: перевірка кешу → резолв моделі → побудова промпту →
`completeStructured` → персист) — цей файл є прямим прецедентом для
"специфічного для фічі LLM-класифікатора, що не є повним рев'ю агента", а не
`reviewPullRequest`.

- **Кеш**: розширити наявну (наразі мертву) таблицю `pr_brief`
  (`server/src/db/schema/reviews.ts:67-71`, зараз лише `{pr_id PK, json}`)
  тими самими колонками кешу застарілості, що вже має `pr_intent` — таблиця
  рядком вище в тому самому файлі: `headSha`, `providerUsed`, `modelUsed`,
  `createdAt`. **Потрібна нова міграція** (`pnpm db:generate` після зміни
  схеми — це санкціонований спосіб за кореневим `CLAUDE.md`: "ніколи не
  редагуй застосовану міграцію; зміни `db/schema.ts` і згенеруй нову").
  `json` зберігає `{summary: string, risks: Risk[]}` — лише
  LLM-згенеровану половину брифу; детермінований rollup і prior-PRs завжди
  обчислюються наживо, ніколи не кешуються, узгоджено з власним вибором Blast
  Radius "без кешу" для його (дешевшого) обчислення.
- **Перевірка кешу**: `cached.headSha === pull.headSha` → повернути кешовані
  `{summary, risks}` без жодного виклику LLM, точно як гілка раннього
  повернення в `IntentClassificationService.classify()`.
- **Резолв моделі**: `resolveFeatureModel(container, workspaceId,
  'risk_brief')` (уже існує, наразі нуль викликачів) → `container.llm(provider)`.
- **Промпт — належно захищений від injection, суворіше за власний прецедент
  `intent-service.ts`** (той файл не обгортає своє заголовок/опис PR у
  `wrapUntrusted()`, що є наявною прогалиною в цій кодовій базі — не
  виправляємо той файл тут, але й не повторюємо цю прогалину в новому коді,
  особливо для фічі *оцінки ризиків* — саме тієї цілі, проти якої застерігає
  сам патерн injection "стверджує, що це test fixture, ігноруй це" в
  `INJECTION_GUARD`):
  - Довірений системний промпт: інструктує модель (а) написати один короткий
    абзац, що синтезує найважливіші проблеми PR, узгоджений з наданими
    числами блокерів/оцінки, і (б) перелічити 0-N структурованих ризиків
    (`kind`, `title`, `explanation`, `severity`, `file_refs` — використати
    zod-схему `Risk` з `brief.ts` напряму як схему структурованого виводу,
    вона вже підходить). Додати `INJECTION_GUARD` (імпортований з
    `@devdigest/reviewer-core`) до цього системного промпту — той самий
    примітив, що вже отримує системний промпт кожного агента рев'ю через
    `assemblePrompt`.
  - Довірений контекстний блок (побудований нами, а не вгаданий LLM):
    заголовок PR, детерміновані числа вердикту/оцінки/блокерів з §1, і власний
    заголовок/зведення знахідок за серйозністю кожного рев'ю, що вижило
    (агреговані лічильники, не повний rationale) — щоб абзац моделі не міг
    суперечити бейджу, показаному поруч.
  - Недовірений блок, обгорнутий через `wrapUntrusted('pr-description',
    pull.body)` та `wrapUntrusted('diff', <заголовки хунків, той самий ліміт
    у стилі MAX_HUNK_HEADER_FILES, що й formatHunkHeaders у
    intent-service.ts>)`.
- **Grounding-еквівалент для `Risk.file_refs`** (потрібен, бо `groundFindings`
  у `reviewer-core/src/grounding.ts` типізується лише проти знахідок з
  діапазонами рядків, не проти простих шляхів `file_refs` — не намагатись
  силоміць туди підігнати): після повернення `completeStructured`
  відфільтрувати `file_refs` кожного ризику до шляхів, які справді є серед
  змінених файлів PR (`pr_files`); якщо `file_refs` ризику стає порожнім
  після фільтрації, відкинути весь ризик (модель заявила вплив на файли поза
  цим diff — незагрунтована заява). Нова чиста функція `groundRisks(risks,
  changedPaths)` у `risk-brief.ts`, тестується окремо (не перевикористовуючи
  `groundFindings`).
- **Персист**: `repo.upsertPrBriefCache(prId, {summary, risks},
  {providerUsed, modelUsed, headSha: pull.headSha})` після grounding —
  кешується заgrounded результат, не сирий вивід моделі.
- **Обробка помилок**: як власний doc-коментар `intent-service.ts` каже про
  себе, збій risk-brief не повинен ніколи блокувати решту вкладки Overview —
  `brief/service.ts` обгортає виклик у try/catch і повертає `risks: [],
  summary: null` з прапорцем у стилі `degraded` при збої (віддзеркалює вже
  реалізований власний патерн `degraded`/`reason` Blast Radius), а не
  провалює весь запит `GET /pulls/:id/brief`.

### 3. "Prior PRs touching these files"

Використати `PrHistoryItem`/`PrHistory` з `brief.ts:90-103`
(`{pr_number, title, merged_at, author, files_overlap, notes}`), з
`notes: ''` завжди (тут без LLM). У `pull_requests` немає колонки
`merged_at` — використати `updated_at` як проксі й виключити рядки, де він
null, замість вигадувати значення.

Форма запиту (узгоджена зі стилем цієї кодової бази "вибрати невеликі набори
рядків, згрупувати в JS", вже застосованим у `pulls/routes.ts:141-157,163-173`,
не важкий SQL-джойн): список `pr_files.path` поточного PR → усі рядки
`pr_files`, що поділяють ці шляхи деінде → згрупувати за `pr_id` у JS,
відкинути поточний PR, з'єднати з `pull_requests`, відфільтрованим до
`repo_id` + `status='merged'`, відсортувати за `updated_at desc`, обмежити 10
з точним нео6меженим `prior_prs_count`. Живе в `brief/repository.ts`/
`brief/service.ts` — не прикручене до власного контракту `BlastRadius`
(лишає Blast концептуально лише про граф викликів) і не третій мережевий
запит (один `GET /pulls/:id/brief` покриває rollup + risks + prior-PRs, та
сама форма "один fetch на одну турботу вкладки Overview", яку вже мають
`useBlastRadius`/`useIntent`).

### 4. Роут + реєстрація

- `server/src/modules/brief/routes.ts` — `GET /pulls/:id/brief`, той самий
  патерн `IdParams` + `getContext` + пошук-PR-потім-404, що й
  `blast/routes.ts`.
- `server/src/modules/brief/service.ts` — оркеструє §1 (синхронно/чисто) +
  §2 (асинхронно, кешовано, у try/catch) + §3 (асинхронно) в один
  `PrBriefSnapshot`.
- Зареєструвати в `server/src/modules/index.ts` (один імпорт + один запис у
  реєстрі) — власний doc-коментар цього файлу вже перелічує "brief" за
  назвою як очікуваний модуль.
- Жодного доступу до БД у `routes.ts` понад пошук PR/repo, так само як у
  `blast/routes.ts` — сервіс резолвить `container.reviewRepo`/`container.llm`/
  `container.repoIntel`, ніколи не створює конкретний клас
  репозиторію/сервісу напряму (правило onion-архітектури, яке вже
  застосовує кожен сусідній модуль).

### 5. Зміни у wire-контракті (обидві vendor-копії — сервер І клієнт, синхронізовані вручну, без symlink)

```ts
export const PrBriefReviewRollup = z.object({
  verdict: Verdict,
  score: z.number().int(),
  findings_count: z.number().int(),
  blockers_count: z.number().int(),
  cost_usd: z.number().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
});
export const PrBriefSnapshot = z.object({
  review_rollup: PrBriefReviewRollup.nullable(),
  summary: z.string().nullable(),      // LLM-згенеровано, null при холодному/невдалому кеші
  risks: z.array(Risk),                // LLM-згенеровано, заgrounded
  degraded: z.boolean().optional(),    // виклик risk-brief LLM провалився/недоступний
  prior_prs: z.array(PrHistoryItem),
  prior_prs_count: z.number().int(),
});
```
(Названо `PrBriefSnapshot`, не `PrBrief` — `brief.ts` уже резервує
`PrBrief = {intent, blast, risks, history}` для іншого, більшого майбутнього
композиту; перевикористання цієї назви тут спричинило б колізію.)
`Risk`/`PrHistoryItem` перевикористані без змін з `brief.ts`. `PrMeta`/
`PrDetail` у `platform.ts` не чіпаються — дані Brief мають власний fetch, не
вбудовуються в `PrDetail`.

### 6. Міграція

Таблиця `prBrief` у `server/src/db/schema/reviews.ts` отримує `headSha`,
`providerUsed`, `modelUsed`, `createdAt` (та сама форма, що вже має таблиця
`prIntent` прямо над нею в тому самому файлі). Запустити `pnpm db:generate`,
щоб згенерувати нову пронумеровану міграцію — не писати вручну, не чіпати
жоден наявний файл `0NNN_*.sql`.

## Клієнт

### 7. Хук `useBrief` + підключення

`client/src/lib/hooks/brief.ts` (новий, власний файл — не концепція "рев'ю",
та сама причина, яку вже документує сам `hooks/blast.ts`), точний шаблон
`useBlastRadius`: `useQuery({queryKey:["brief",prId], queryFn:()=>
api.get<PrBriefSnapshot>(`/pulls/${prId}/brief`), enabled:!!prId})`.

### 8. Перебудова `IntentCard` → `IntentAndRiskCard`, і заголовка `BlastRadiusCard`

Обидві картки зараз використовують `<section><SectionLabel/><div style={s.card}>...</div></section>`
— заголовок сидить **за межами** рамки. Макет хоче, щоб заголовок був
**усередині** тієї самої рамки, що й контент. Виправити однаково в обох:
`<section><div style={s.card}><div style={s.headerRow}><SectionLabel .../></div><div style={s.divider}/>...контент...</div></section>`.
`SectionLabel` (`client/src/vendor/ui/primitives/SectionLabel.tsx`) зараз
жорстко задає `marginBottom:14` без пропа для перевизначення — додати один
опційний проп `noMargin?: boolean` (зміна в один рядок), щоб він міг сидіти
впритул усередині відступленого рядка заголовка без подвоєння відступів.
Додати `s.headerRow`/`s.divider` у `styles.ts` кожної картки (`divider` =
`borderTop: '1px solid var(--border)'`, та сама ідея, що вже використовує
`groupBody.borderTop` картки `BlastRadiusCard` на рівень нижче).

Перейменувати `IntentCard` → `IntentAndRiskCard` (папку + файли), бо вона
стає єдиною картою з рамкою і двома внутрішніми секціями (Intent, потім
роздільник, потім Risk Areas), а не карткою з однією ціллю — узгоджено з тим,
як `BlastRadiusCard` уже компонує кілька внутрішніх секцій (banner/body)
усередині одного `s.card`. Risk Areas рендерить `brief.risks` як `Badge`
(перевикористати примітив, уже імпортований у наявному `IntentCard.tsx`),
кольорований за `severity` (`high→var(--crit)`, `medium→var(--warn)`,
`low→var(--info)`, усі вже використовувані CSS-змінні). Порожній стан і
текст заголовка секції перевикористовують **уже наявні** ключі
`client/messages/en/brief.json` (`block.risks: "Risks"`, `noRisks` тощо —
підтверджено наявні, автозавантажуються `client/src/i18n/request.ts`,
потрібен лише `useTranslations("brief")`, жодного нового i18n-підключення).

`BlastRadiusCard.tsx` отримує те саме виправлення заголовка-усередині-рамки,
плюс нову секцію-футер після наявного тіла: "Prior PRs touching these files
[{count}]" зі стрілкою, розгортання по кліку рендерить записи `prior_prs`
(номер/заголовок/автор/updated_at/чіпи files_overlap) — перевикористовує вже
наявні ключі `block.history`/`noHistory`/`overlap` у `brief.json`.

### 9. Нова `PrBriefCard`

`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/PrBriefCard/{PrBriefCard.tsx,styles.ts,index.ts,PrBriefCard.test.tsx}`
— усі перевикористані блоки, нічого нового не будувати візуально:
- Бейдж вердикту: `VERDICT_META[verdict]` + іконка, той самий мапінг, що вже
  використовує `VerdictBanner.tsx` (`.../VerdictBanner/constants.ts`).
- Шкала оцінки: `<CircularScore score={score} size={52} stroke={5}/>`
  (`client/src/vendor/ui/primitives/CircularScore.tsx`) — уже точно форма
  "кільце + велике число + підпис", уже використовується в цьому самому
  розмірі в `VerdictBanner.tsx`. Не будувати нову шкалу.
- Рядок вартості/токенів: `<RunCostBadge costUsd={...} tokensIn={...}
  tokensOut={...} variant="detailed" tokenFormat="pair"/>`
  (`client/src/components/run-cost-badge/RunCostBadge.tsx`) — уже форматує
  точно `$0.014` / `8.2K→1.3K`; уже безпечний до null, коли токенів немає.
- Прозовий summary + кількість знахідок/блокерів: простий текст з
  `brief.review_rollup`/`brief.summary`.
- Не рендерить нічого (`return null`), коли `review_rollup` дорівнює `null`,
  узгоджено з уже встановленою конвенцією `BlastRadiusCard` для "поки нема
  чого показати."

### 10. Двоколонкова сітка

Немає наявного прецеденту фіксованої двоколонкової сітки для іменованих
секцій ніде в `client/src/app` (кожен наявний `display:grid` — це N-елементна
auto-fill сітка списку). Додати в `OverviewTab/styles.ts`:
```ts
twoColGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
```
Перевірити `client/src/app/globals.css` на наявний токен breakpoint перед
додаванням фолбеку для вузьких viewport; якщо такого нема, лишити просто —
звичайне правило `@media` не виражається через конвенцію inline-style-object
цієї кодової бази, тож не вигадувати CSS-модуль лише заради однієї сітки.
Розумний мінімальний фолбек: пропустити адаптивне згортання цього разу
(сторінка деталей PR уже й так усюди в `page.tsx` передбачає
десктоп-подібний контейнер `maxWidth:1080`), якщо швидкий погляд на
`globals.css` не виявить наявного патерну, вартого копіювання.

`OverviewTab.tsx`: викликати `useBrief(prId)` один раз, рендерити
`<PrBriefCard rollup={brief?.review_rollup} summary={brief?.summary}
degraded={brief?.degraded}/>` над сіткою, потім сітку з
`<IntentAndRiskCard intent={intent} risks={brief?.risks}/>` (ліворуч) і
`<BlastRadiusCard ... priorPrs={brief?.prior_prs}
priorPrsCount={brief?.prior_prs_count}/>` (праворуч).

### 11. Демо-дані

`server/src/db/seed.ts` наразі засіває файли PR #482 як
`src/middleware/ratelimit.ts`, `src/api/public/webhooks.ts`, `src/config.ts`,
`src/api/users.ts` — жоден з яких не спрацює на паттерн автентифікації чи
сигнал нової залежності, які реальний виклик risk-brief LLM правдоподібно
міг би сам виявити, і взагалі немає рядка `package.json`. Додати рядок файлу
`package.json` (патч, що додає `ioredis`) і переконатись, що хоча б один
шлях відповідає паттерну автентифікації, щоб живе демо справді мало що
знайти для LLM і що втримати для `groundRisks`. Це звичайне редагування
сід-даних, не міграція.

## Тести

- `server/src/modules/brief/rollup.test.ts` — `latestReviewPerAgent`
  (дедуп за agentId, найновіше спершу), `computeVerdict`
  (blockers>0/findings>0/жодного), `pickLowestScore` (tie-break за
  свіжістю), і явний тест, що доводить розходження вартості/токенів
  (усі прогони) та блокерів/знахідок (останній-на-агента) для агента,
  прогнаного двічі — закріплює навмисний поділ на два набори рядків.
- `server/src/modules/brief/risk-brief.test.ts` — влучення в кеш (свіжий
  `headSha`, нуль викликів LLM, дзеркалить власну тестовану форму
  `intent-service`, якщо вона є, інакше написати з нуля), промах кешу →
  викликає `completeStructured` з фейковим `LLMProvider`, `groundRisks`
  (відкидає ризик, у якого кожен запис `file_refs` поза межами змінених
  файлів PR; лишає ризик хоча б з одним валідним записом, відфільтрувавши
  невалідні), і шлях помилки (LLM кидає виняток → `degraded:true`, без
  провалу на рівні запиту).
- `server/src/modules/brief/prior-prs.test.ts` — групування перетинів,
  виключення поточного PR, фільтр лише-merged, обмеження в 10 з точним
  `prior_prs_count`, виключення рядків з null `updated_at`.
- `server/test/brief.it.test.ts` (інтеграційний, за наявності Docker) —
  реальний self-join запит проти засіяних `pr_files`, і round-trip нових
  колонок міграції через справжній Postgres.
- Клієнт: `PrBriefCard.test.tsx` (дзеркалить патерн мокання
  `BlastRadiusCard.test.tsx`), `IntentAndRiskCard.test.tsx` (новий — жодного
  попереднього тесту `IntentCard` не існувало), розширити
  `BlastRadiusCard.test.tsx` новим футером prior-PRs.

## Перевірка "не чіпати" / архітектурні ризики

- **Міграція**: одна нова міграція, згенерована через `pnpm db:generate` зі
  зміни `db/schema.ts` — санкціонований шлях, без вручну написаного SQL,
  без редагування жодного вже застосованого файлу міграції.
- **Injection guard**: новий промпт risk-brief — перше місце в цьому плані,
  що торкається недовіреного тексту PR напряму — `wrapUntrusted()` +
  `INJECTION_GUARD` (обидва вже експортовані з `@devdigest/reviewer-core`)
  використовуються явно, навмисно суворіше за наявний (слабший) прецедент
  `intent-service.ts`, не слабше.
- **Grounding gate**: `groundFindings` у `reviewer-core/src/grounding.ts` не
  чіпається — він не застосовний до `Risk` (немає діапазонів рядків), тож
  написано новий, окремий `groundRisks`, а не силоміць підігнано чи
  послаблено наявний gate.
- **`risk_brief` FeatureModelId**: цей план — його перший реальний
  викликач — не перепризначення, точно заявлене призначення слоту.
- **Таблиця `pr_brief`**: розширена (нові колонки через міграцію), не
  замінена й не переінтерпретована — все ще з PK за `pr_id`, все ще
  належить власному `repository.ts` нового модуля `brief`.
- **Межі onion-архітектури**: `brief/service.ts` резолвить
  `container.reviewRepo` / `container.llm` / `container.repoIntel` лише
  через DI-контейнер, та сама дисципліна, яку вже дотримує `BlastService`.

## Перевірка

1. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — нові
   unit-тести проходять.
2. `cd server && pnpm exec vitest run .it.test` (з піднятим Docker) —
   `brief.it.test.ts` проходить, міграція чисто застосовується на свіжій
   тестовій БД.
3. `cd server && pnpm typecheck` / `cd client && pnpm typecheck`.
4. `cd server && pnpm db:generate`, потім `pnpm db:migrate` локально,
   переконатись, що нові колонки існують (`\d pr_brief` чи еквівалент) перед
   написанням коду проти них.
5. `./scripts/dev.sh`, відкрити PR #482 (після додавання сід-даних),
   підтвердити: картка PR Brief рендерить вердикт/оцінку/блокери/вартість-
   токени; перше завантаження запускає один реальний виклик LLM risk-brief
   (перевірити логи сервера / вартість), друге завантаження того самого PR —
   влучення в кеш (жодного нового виклику LLM, той самий `head_sha`); чіпи
   Risk Areas рендеряться усередині картки Intent з роздільником; заголовок
   картки Blast Radius тепер сидить усередині її рамки й показує робочий
   футер Prior-PRs; уся вкладка Overview — двоколонкова сітка під карткою PR
   Brief.
6. `cd client && pnpm test` — увесь клієнтський набір тестів зелений,
   включно з новими/перейменованими тестами компонентів.
