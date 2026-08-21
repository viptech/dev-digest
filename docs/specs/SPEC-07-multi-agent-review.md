# Spec: Multi-Agent Review — паралельний прогін кількох агентів на одному PR
Spec ID: SPEC-07
Status: approved
Supersedes: жодного попереднього `SPEC-NN` не замінює. Розширює вже наявний
однoagентний прогін (`POST /pulls/:id/review`, `server/src/modules/reviews/`)
новим режимом "кілька агентів одночасно" — не змінює жодної поведінки
однoagентного шляху (`{agentId}`/`{all:true}` лишаються буквально як є).

## Проблема й користувач

**Реконсиляція з вихідними даними задачі (читати перед AC).** Дослідницька
сесія, що передувала цій спеці, спиралась на лабораторну
(`04-hands-on-lab.md`, L07 Частина 2) і на реальний дизайн-мокап. Перевірка
`file:line` виявила **дві суттєві розбіжності** з тим, що лабораторна й
нотатки користувача стверджують як "вже готове" — обидві змінюють обсяг
задачі. (1) **НЕ підтверджено: "паралельне виконання вже готове".**
Лабораторна й мокап ("4 agents · fan-out via worktrees · 7.3s total")
натякають, що кілька агентів уже виконуються одночасно. Фактично
`ReviewRunExecutor.executeRuns` (`server/src/modules/reviews/run-executor.ts:160-197`)
виконує черг агентів **послідовним** `for (...) { await this.runOneAgent(...) }`
— кожен агент повністю завершується (весь LLM-виклик), перш ніж почати
наступний. Ізоляція збою на агент (`try/catch` per job) — так, вже є;
*одночасність* у часі — ні. Ця спека **включає** заміну цього циклу на
конкурентне виконання (`Promise.allSettled`-подібний паттерн) як частину G2
нижче — без цього "N agents in parallel, ~7s total" з мокапу технічно
неможливо. "Fan-out via worktrees" у копірайтингу мокапу — презентаційний
текст про паралельність, не буквальна вимога git-worktree інфраструктури
(worktree-ізоляція в цьому курсі стосується кодуючих агентів, не
LLM-рев'ю-викликів) — ця спека НЕ вводить жодного git-worktree механізму.
(2) **НЕ підтверджено: "евристика групування знахідок вже існує".**
`grep -rn "cluster|similarity|dedup|Cluster" server/src reviewer-core/src`
не дав жодного релевантного збігу. Ця спека вводить нову, мінімальну
евристику "на льоту" (AC-18) — не шукає і не переносить неіснуючий код.
Дві інші заяви лабораторної/нотаток підтверджені без розриву й ПОВНІСТЮ
готові до перевикористання без жодної зміни: `client/src/vendor/ui/LiveLogStream.tsx`
**вже підключений** (`RunTraceDrawer.tsx:102` рендерить його для Live-log
таба — твердження "готовий компонент, не підключений" застаріле; ця спека
лише повторно використовує той самий вже робочий шлях, `RunTraceDrawer`
цілком, без форку); і сайдбар `RunTraceDrawer` (Configuration/Stats/
Findings/Prompt assembly з expand+copy+fullscreen на кожен блок/Tool
calls/Raw output, "Copy raw output" у футері) — перевірено файл за файлом
(`RunTraceDrawer.tsx`, `_components/TraceBody/TraceBody.tsx`,
`_components/PromptBlock/PromptBlock.tsx`) і повністю відповідає опису з
задачі, використовується як є через уже наявний `?trace=<runId>`
query-параметр (`page.tsx:211-219`), нуль змін самого дровера.

**Проблема.** Один PR може одночасно нести ризик безпеки, деградацію
продуктивності й порушення доменних конвенцій — жоден одиночний агент не
покриває всі три кути одразу. Сьогодні `POST /pulls/:id/review` вже вміє
запустити або одного агента (`{agentId}`), або всі enabled (`{all:true}`)
(`server/src/modules/reviews/service.ts:48-59`), і UI (`RunReviewDropdown`)
показує обидва шляхи — але немає способу свідомо обрати ПІДМНОЖИНУ
(наприклад "security + performance, але не junior-mentor"), і немає жодного
екрану, що показує результати кількох агентів РАЗОМ: сьогодні кожен запуск
рендериться окремим акордеоном у "Agent runs" tab (`FindingsTab`), без
групування, без порівняння, без явного погляду на розбіжності між агентами.

**Користувач.** Той самий рев'юер/власник агентів, який після написання
кількох спеціалізованих агентів (security, performance, junior-mentor,
customer-facing — за нотатками користувача, 2-3 такі агенти вже існують у
БД студії з попередніх уроків) хоче одним кліком прогнати обрану підмножину
на конкретному PR, побачити результати side-by-side, зрозуміти, ДЕ агенти
розходяться (один каже "WARNING", інший — "did not flag" те саме місце), і
розібратись зі знахідками (accept/dismiss/turn into eval case) без
дублікатів, що ховають, хто саме що сказав.

## Goals / Non-goals

**Goals**

- **G1 — Explicit agent picker + Configure run screen.** Новий екран
  (рендериться інлайн у вкладці Multi-Agent Review, не модалка — немає
  дизайн-мокапу для нього, тож найпростіша форма без нового компонента-
  оверлею) з чекбоксами по КОЖНОМУ агенту воркспейсу (не лише enabled —
  той самий принцип "показати всіх", що вже в `RunReviewDropdown.tsx:54-61`),
  оцінкою часу/вартості з минулих прогонів (перевикористовує вже наявний
  `GET /agents/:id/stats`'s `avg_cost_usd`/`avg_latency_ms`,
  `server/src/modules/agents/stats-helpers.ts:103-104` — нуль нового
  серверного коду для самої оцінки) і кнопкою "Run multi-agent review (N)".
- **G2 — Реальне конкурентне виконання + групування прогонів.** Розширити
  `RunRequest` новим `agentIds: string[]`, `ReviewService.resolveTargets`
  новою гілкою для нього, і — критично (див. Реконсиляцію) —
  `ReviewRunExecutor.executeRuns`'s послідовний `for`-цикл замінити на
  конкурентне виконання jobs. Кожен виклик, де `targets.length > 1`
  (незалежно від того, чи цілі прийшли через новий `agentIds`, чи через
  вже наявний `all:true`), створює один рядок `multi_agent_runs`
  (`server/src/db/schema/runs.ts:46-55` — таблиця вже існує, порожня) і
  зв'язує кожен свій `agent_runs` рядок через НОВУ nullable-колонку
  `agent_runs.multi_agent_run_id`.
- **G3 — Мінімальна, обчислювана "на льоту" евристика групування
  знахідок.** Дві знахідки різних прогонів ОДНОГО групового прогону
  належать одному кластеру, коли `file` збігається і `[start_line,
  end_line]` перетинаються (чи в межах ±2 рядків). READ-ONLY над уже
  персистованими `findings` (через уже наявний `reviewsForPull`) — жодної
  нової таблиці, жодної мутації оригінальних рядків.
- **G4 — "Where agents disagree".** Read-only блок, побудований з тих самих
  кластерів (G3): для кожного кластера — по одному рядку на кожного агента
  групи з вердиктом чи "did not flag"; перемикач "Show only conflicts"
  ховає кластери без розбіжності. Жодної нової персистованої моделі
  консенсусу.
- **G5 — Сторінка результатів, Columns/Tabs.** Обидва режими читають ті самі
  дані (`reviewsForPull`, звужені до `run_ids` поточної групи). Columns —
  картка на run (score/name/cost/status/findings/View trace), Tabs+detail —
  таб на агента з розгорнутими `FindingCard`-картками (title/category/
  file:line/confidence/rationale/suggestion/Accept/Dismiss/Turn into eval
  case) — перевикористання вже наявних `CircularScore`, `RunCostBadge`,
  `SEV`, `FindingCard`, `FindingsPanel`'s дій, БЕЗ жодної нової серверної
  мутації для самих знахідок.
- **G6 — Перевикористання `RunTraceDrawer`.** "View trace" з будь-якої
  колонки/таба відкриває той самий дровер тим самим `?trace=<runId>`
  query-параметром, що вже працює на PR-сторінці — нуль форків.
- **G7 — "Останній прогін замість автопікера".** Повернення на вкладку
  Multi-Agent Review з уже наявним минулим груповим прогоном цього PR
  показує НАЙНОВІШИЙ груповий прогін одразу; picker/Configure run
  відкривається лише через явну кнопку "Start New Review".

**Non-goals**

- **Git-worktree ізоляція виконання агентів** — "fan-out via worktrees" у
  мокапі — презентаційний текст про паралельність, не буквальна вимога
  (Реконсиляція, п.1). Ізоляція збоїв лишається на рівні try/catch per job,
  як і сьогодні.
- **Нова персистована модель консенсусу/групування знахідок** — G3/G4
  обчислюються на льоту при кожному читанні, ніколи не зберігаються;
  наступний прогін того самого PR перебудовує кластери з нуля.
- **`ci/` і `agent-runner/`** — не торкаються цією спекою (межа worktree A з
  завдання); мультиagent-запуск лишається студійною (local), не CI-фічею.
- **"Learn" і "Reply to author"** з мокапу Tabs+detail — `FindingActionKind`
  включає `'learn'`/`'reply'` у контракті, але сервіс явно кидає 400
  `invalid_action` для обох (`server/src/modules/reviews/findings.ts:31-33`),
  і жодного HTTP-роута для них не зареєстровано
  (`FINDING_ACTIONS = ['accept', 'dismiss']`, `routes.ts:22`). Рендерити
  кнопку без робочого бекенду суперечило б принципу "не приховувати
  ціну" — обидві кнопки НЕ рендеряться в цій спеці.
- **Скасування/попередження про паралельний "старий" груповий прогін, що ще
  виконується, коли користувач тисне "Start New Review"** — див. Open
  questions.
- **Зміна `reviewer-core`** — кожен агент і надалі проходить ТОЙ САМИЙ
  однoagентний pipeline (`assemblePrompt → LLM → groundFindings`); ця спека
  міняє лише те, СКІЛЬКИ таких пайплайнів запускається одночасно і як
  сервер їх групує/показує, не сам пайплайн.
- **Іконка/точна верстка Configure run screen і перемикача Columns/Tabs** —
  дизайн-мокап не містить артборду для пікера (перевірено користувачем
  явно); ця спека фіксує ПОВЕДІНКУ (EARS нижче), не піксельну верстку.

## User stories

- Як рев'юер, я відкриваю PR, переходу на нову вкладку "Multi-Agent" —
  бачу порожній стан із кнопкою "Start New Review" (перший візит) або
  результати останнього групового прогону (повторний візит).
- Як той самий рев'юер, я тисну "Start New Review", позначаю
  security+performance+junior-mentor (не всіх), бачу орієнтовний час і
  вартість, тисну "Run multi-agent review (3)".
- Як той самий рев'юер, я бачу Columns-режим: три картки, кожна зі своїм
  live-статусом поки виконується, і фінальним score/cost/findings, коли
  завершується — одна невдала колонка не блокує дві інші.
- Як той самий рев'юер, я перемикаюсь на Tabs+detail, відкриваю таб
  Security, бачу розгорнуту знахідку з suggested fix, тисну Accept.
- Як той самий рев'юер, я гортаю донизу до "Where agents disagree", бачу
  місце коду, де Security каже WARNING, а Junior Mentor — "did not flag",
  вмикаю "Show only conflicts", щоб позбутись шуму одноголосних місць.
- Як той самий рев'юер, я тисну "View trace" на колонці Performance — бачу
  той самий сайдбар, що вже відкривається з "Agent runs" tab, з тими самими
  Configuration/Stats/Prompt assembly/Tool calls/Raw output.

## Acceptance criteria (EARS)

**Точка входу і "останній прогін" (G7)**

- **AC-1** (ubiquitous). Multi-Agent Review (shall) бути доступним як новий
  таб `multi-agent` у вже наявному `Tabs`-барі PR-сторінки
  (`PrDetailHeader.tsx:111-121`, поруч з `overview`/`findings`/`diff`/
  `blast`), той самий `?tab=`-патерн, що решта.
- **AC-2** (event-driven). КОЛИ на вкладці Multi-Agent Review немає жодного
  минулого групового прогону цього PR, система (shall) показати порожній
  стан із кнопкою "Start New Review", а НЕ Configure run screen одразу.
- **AC-3** (event-driven). КОЛИ на вкладці Multi-Agent Review існує
  принаймні один минулий груповий прогін цього PR, система (shall)
  показати НАЙНОВІШИЙ груповий прогін (за `ran_at` найновішого run у групі)
  одразу, з видимою кнопкою "Start New Review" (не автоматичним відкриттям
  пікера).
- **AC-4** (event-driven). КОЛИ користувач тисне "Start New Review",
  система (shall) показати Configure run screen (G1) замість поточних
  результатів (заміна вмісту вкладки, не нова сторінка/модалка).

**Configure run screen (G1)**

- **AC-5** (ubiquitous). Configure run screen (shall) показати чекбокс на
  КОЖНОГО агента воркспейсу (enabled і disabled), з дефолтним станом =
  `agent.enabled` цього агента — позначення на екрані НЕ персистує
  `agent.enabled`, лише визначає цільову підмножину цього одного прогону.
- **AC-6** (ubiquitous). Оцінка вартості (shall) дорівнювати сумі
  `avg_cost_usd` (`GET /agents/:id/stats`) кожного позначеного агента;
  агент без жодного попереднього прогону (`avg_cost_usd: null`) (shall) не
  додавати нічого до суми і (shall) позначатись окремо (напр. "no run
  history") у своєму рядку picker'а.
- **AC-7** (ubiquitous). Оцінка часу (shall) дорівнювати НАЙБІЛЬШОМУ
  `avg_latency_ms` серед позначених агентів (не сумі) — агенти виконуються
  конкурентно (G2), тож найповільніший визначає орієнтовний загальний час.
- **AC-8** (unwanted behavior). ЯКЩО позначено 0 агентів, ТО кнопка "Run
  multi-agent review (0)" (shall) бути disabled.
- **AC-9** (event-driven). КОЛИ користувач тисне "Run multi-agent review
  (N)", система (shall) викликати `POST /pulls/:id/review` з
  `{agentIds: string[]}` (новий `useRunReview`-параметр поруч із вже
  наявними `agentId`/`all`, `client/src/lib/hooks/reviews.ts:141-145`) і
  після відповіді показати Columns-режим нового групового прогону
  (AC-13-16 нижче визначають сам груповий прогін).

**Backend: явна підмножина агентів + конкурентне виконання + групування (G2)**

- **AC-10** (ubiquitous). `RunRequest` (`server/src/vendor/shared/contracts/platform.ts:284-288`,
  обидві копії `vendor/shared`) (shall) отримати новий опціональний
  `agentIds: z.array(z.string()).min(1).max(20).optional()` поряд із вже
  наявними `agentId`/`all` — рівно одне з трьох очікується непорожнім;
  порожній/відсутній усі три (shall) лишити поведінку
  `invalid_run_request` (400) незмінною (`service.ts:58`).
- **AC-11** (ubiquitous). `ReviewService.resolveTargets` (shall) отримати
  нову гілку для `agentIds`: резолвити кожен id через уже наявний
  `agents.getById(workspaceId, id)`.
- **AC-12** (unwanted behavior). ЯКЩО хоч один id у `agentIds` не
  резолвиться в агента ЦЬОГО воркспейсу, ТО запит (shall) провалитись 404
  ДО створення будь-якого `agent_runs` рядка — жодного часткового
  групового прогону.
- **AC-13** (ubiquitous). `ReviewRunExecutor.executeRuns`'s послідовний
  `for`-цикл по `jobs` (`run-executor.ts:160-197`) (shall) бути замінений
  на конкурентне виконання (кожен `runOneAgent` стартує без очікування
  завершення попереднього; помилка одного job (shall) і надалі не
  впливати на решту — той самий try/catch-per-job контракт, лише без
  послідовного `await` між job'ами).
- **AC-14** (ubiquitous). Кожен виклик `runReview`, де `targets.length > 1`
  (shall) створити ОДИН новий рядок `multi_agent_runs`
  (`workspaceId`, `prId`) і записати його `id` на КОЖЕН створений
  `agent_runs` рядок цього виклику через нову nullable-колонку
  `agent_runs.multi_agent_run_id` (`.references(() => multiAgentRuns.id,
  {onDelete: 'set null'})`, нова migration через `pnpm db:generate` — та
  сама конвенція, що всі інші migrations, ніколи рукописна) — незалежно
  від того, чи цілі прийшли через новий `agentIds`, чи через вже наявний
  `all:true` з 2+ enabled агентами.
- **AC-15** (ubiquitous). Коли `targets.length <= 1` (одиночний
  `agentId` чи `all:true` з рівно одним enabled агентом), `multi_agent_run_id`
  (shall) лишатись `null` — групування має сенс лише для 2+ одночасних
  агентів.
- **AC-16** (ubiquitous). `ReviewRunResponse`
  (`server/src/vendor/shared/contracts/review-api.ts:52-57`, обидві копії)
  (shall) отримати нове поле `run_group_id: z.string().nullable()` —
  `null`, коли AC-15 застосовується.
- **AC-17** (ubiquitous). `RunSummary`
  (`server/src/vendor/shared/contracts/trace.ts:114-135`, обидві копії)
  (shall) отримати нове поле `multi_agent_run_id: z.string().nullable()`,
  заповнюване з нової колонки — вже наявний `GET /pulls/:id/runs` (shall)
  просто повертати це поле, БЕЗ нового роута; клієнт групує runs за цим
  полем чистою функцією (той самий "compute on read" принцип, що вже
  застосований `groupRuns` для eval set-runs,
  `client/.../EvalsTab/EvalsTab.tsx:83`), сортуючи групи за найновішим
  `ran_at` усередині кожної.

**Групування знахідок — мінімальна евристика (G3)**

- **AC-18** (ubiquitous) — **ключове дизайн-рішення, не hand-waved.**
  Готової евристики групування знахідок НЕ знайдено в кодовій базі (див.
  Реконсиляцію) — ця спека вводить нову, обчислювану на льоту (не
  персистовану) евristику: дві знахідки різних прогонів ОДНОГО групового
  прогону належать одному кластеру, коли (а) `file` збігається буквально,
  і (б) їхні `[start_line, end_line]` діапазони перетинаються або лежать у
  межах ±2 рядків одне від одного. `category`/`severity` НЕ впливають на
  кластеризацію (лише на відображення) — свідомо просто, без NLP/embedding-
  подібної схожості тексту.
- **AC-19** (ubiquitous). Кластеризація (AC-18) (shall) виконуватись
  READ-ONLY над уже персистованими `findings` (через уже наявний
  `reviewsForPull`, звужений до `run_ids` поточної групи) — ніколи не
  мутуючи, не видаляючи, не позначаючи дублікатом жодного оригінального
  рядка `findings`.
- **AC-20** (ubiquitous). Картка кластера в UI (Columns/Tabs) (shall)
  показувати ВСІ знахідки кластера (не лише "репрезентативну"), кожну зі
  своєю атрибуцією агента (`review.agent_name`/`agent_id`) — не втрачаючи
  оригіналів чи атрибуції (буквальна вимога задачі).

**"Where agents disagree" (G4)**

- **AC-21** (ubiquitous). Блок "Where agents disagree" (shall)
  обчислюватись READ-ONLY з тих самих кластерів (AC-18) для поточного
  групового прогону — без нової персистованої моделі консенсусу.
- **AC-22** (ubiquitous). Для кожного кластера блок (shall) показати ОДИН
  рядок-картку на кожного агента групи зі статусом `status: 'done'`: якщо
  агент має знахідку в кластері — severity+короткий title; якщо не має —
  "did not flag" (буквально).
- **AC-23** (unwanted behavior). ЯКЩО агент групи ще `running` чи
  `status: 'failed'|'cancelled'`, ТО його рядок у блоці (shall) показувати
  "pending"/"failed" відповідно — НЕ "did not flag" (щоб не сплутати "не
  встиг перевірити" з "перевірив і не знайшов").
- **AC-24** (event-driven). КОЛИ увімкнено перемикач "Show only conflicts"
  (дефолт: вимкнено — той самий дефолт, що вже прийнятий для аналогічного
  toggle'а `hideLow` у `FindingsPanel.tsx:41`), список (shall) показувати
  лише кластери, де НЕ всі присутні (`status: 'done'`) агенти групи
  одноголосні — "одноголосні" = усі зафлагували з тією самою severity, АБО
  усі "did not flag"; кластер з РІВНО одним `done`-агентом групи (shall)
  вважатись одноголосним (нічого порівнювати) і теж прихованим при
  увімкненому перемикачі.

**Сторінка результатів — Columns / Tabs+detail (G5, G6)**

- **AC-25** (ubiquitous). Сторінка результатів (shall) мати перемикач
  Columns/Tabs (стан `?view=columns|tabs` на тій самій вкладці, дефолт
  `columns`), обидва режими читають ОДНІ Й ТІ САМІ дані
  (`reviewsForPull`, звужені до `run_ids` поточної групи) — без окремого
  запиту на кожен режим.
- **AC-26** (ubiquitous). Columns-режим (shall) показати одну колонку-
  картку на кожен run групи: `CircularScore` (`@devdigest/ui`, той самий
  компонент, що вже `RunHistory.tsx:168`), назва агента, `RunCostBadge`,
  статус-бейдж (той самий `outcomeOf`-подібний розрахунок, що вже
  `RunHistory.tsx:25-39`), список знахідок цього run (title+`file:line`+
  severity-іконка з `SEV`), і кнопку "View trace" — той самий набір даних,
  що вже рендерить `RunHistory`, лише картковим, не рядковим, layout'ом.
- **AC-27** (event-driven). КОЛИ хоч один run поточної групи має
  `status: 'running'`, Columns-режим (shall) оновлюватись через ТОЙ САМИЙ
  4-секундний polling, що вже реалізований `usePrRuns`
  (`client/src/lib/hooks/reviews.ts:42-50`) — без нової SSE-підписки на
  саму сітку колонок (SSE лишається виключно всередині `RunTraceDrawer`
  для конкретного run'а, як і сьогодні).
- **AC-28** (ubiquitous). Tabs+detail-режим (shall) показати одну таб на
  агента групи (з тим самим `CircularScore`-бейджем у самому табі), під
  активним табом — короткий summary (`review.score`+`review.summary`) і
  список `FindingCard` (уже наявний компонент,
  `FindingCard.tsx` — title/category/`file:line`/confidence/rationale/
  suggestion/Accept/Dismiss/Turn into eval case), відфільтрований до
  findings цього агента — той самий `FindingsPanel`-подібний рендер, що
  вже є в "Agent runs" tab, БЕЗ жодної нової серверної мутації для самих
  знахідок.
- **AC-29** (unwanted behavior). Кнопки "Learn" і "Reply to author" (shall)
  НЕ рендеритись у жодній картці знахідки цієї фічі (Non-goals) —
  `FindingCard` вже не рендерить їх (`FindingCard.tsx:131-161` — лише
  Accept/Dismiss/Turn into eval case), тож перевикористання компонента
  автоматично задовольняє цей AC без додаткового коду.
- **AC-30** (event-driven). КОЛИ користувач тисне "View trace" у будь-якій
  колонці (Columns) чи табі (Tabs), система (shall) відкрити ТОЙ САМИЙ
  `RunTraceDrawer` через той самий `?trace=<runId>` query-параметр, що вже
  працює на PR-сторінці (`page.tsx:211-219`) — без форку чи спрощеної
  версії дровера.
- **AC-31** (unwanted behavior). Один невдалий/скасований run групи
  (`status: 'failed'|'cancelled'`) (shall) НЕ приховувати і не блокувати
  відображення результатів решти run'ів тієї самої групи — той самий
  per-job isolation принцип, тепер видимий і в конкурентному виконанні
  (AC-13): колонка/таб цього агента показує `r.error`
  (`RunHistory.tsx:194-201`-подібно), решта лишаються повнофункціональними.

## Edge cases

- Воркспейс має < 2 enabled агентів → Configure run screen все одно
  дозволяє позначити 1 агента і запустити (AC-8 блокує лише 0), просто без
  групування (AC-15) — однoagентний прогін виглядає як завжди, "Multi-
  Agent Review" вкладка показує один результат без Columns/Tabs
  розрізнення сенсу (обидва режими показують один run) і без "Where agents
  disagree" (порожньо/приховано — кластер з 1 агентом).
- Діфф PR не завантажується (`loadDiff` кидає) → вже наявний `failAll()`
  (`run-executor.ts:81-100`) позначає КОЖЕН job у групі `failed` з тим
  самим повідомленням; груповий прогін все одно створюється (AC-14, бо
  `targets.length > 1` визначається ДО виконання), Columns/Tabs
  показують усі колонки failed (AC-31), "Where agents disagree" — порожньо
  (жодних findings).
- Класифікація Intent провалюється/скіпається → та сама вже наявна
  деградація (`run-executor.ts:156-158`) — кожен агент групи просто не
  отримує `## Intent` секцію; кластеризація (AC-18/AC-19) не залежить від
  Intent взагалі, тож нічого в цій спеці не змінюється.
- Агента видалено з воркспейсу між прогоном і переглядом Multi-Agent
  Review пізніше → `agent_runs.agentId` вже має `onDelete: 'set null'`,
  `RunSummary.agent_name` вже `null`-безпечний
  (`RunHistory.tsx:188`: `r.agent_name ?? "Agent"`) — Columns-режим (AC-26)
  успадковує той самий fallback без спеціального коду.
- Знахідка в кластері вже Accepted/Dismissed одним агентом раніше → "Where
  agents disagree" все одно показує ВСІ атрибуції кластера (AC-20, AC-22) з
  уже наявними accepted/dismissed позначками — рішення по одному findings
  НЕ видаляє його з кластера.
- Дуже великий PR (багато файлів/знахідок × кілька агентів) → покривається
  NFR "продуктивність кластеризації" і відповідним Open question
  ("Кепування кластеризації за обсягом findings") — конкретна межа
  залишена на рівень Development Plan, не AC цієї спеки.
- Користувач тисне "Start New Review", поки попередній груповий прогін цього
  ж PR ще має `running` job'и → **вирішено** (див. Open questions): дозволити
  без попередження. Новий груповий прогін стає найновішим (AC-3 показує
  саме його); старий продовжує виконуватись і персистуватись у фоні, лише
  перестає бути видимим на цій вкладці.

## Non-functional requirements

Пропущено через скіл `security` (OWASP Top 10:2025 / Agentic AI Security
ASI01/ASI09) — той самий обсяг перевірки, що вже застосований у SPEC-01/
SPEC-03/SPEC-04/SPEC-05/SPEC-06 до їхніх LLM-викликів і недовіреного
контенту. Знахідки:

- **MEDIUM — cost abuse через явний список агентів в одному запиті (A06
  Insecure Design).** `agentIds` дозволяє явно перелічити до N агентів в
  ОДНОМУ HTTP-виклику, кожен з яких фан-аутить у власний LLM-виклик —
  структурно той самий клас, що вже прийнятий і мітигований для `all:true`
  (немодифікований шлях) та для SPEC-06's `POST /skills/:id/eval-runs`.
  Мітигація: `.max(20)` на масиві (AC-10, не вводить нову межу, вирівнює з
  реалістичною верхньою межею кількості агентів воркспейсу) +
  вже наявний rate limit `{max: 10, timeWindow: '1 minute'}` на самому
  `POST /pulls/:id/review` (`routes.ts:33`, не змінюється — той самий роут,
  жодного нового лімітера).
- **HIGH → MEDIUM (за наявним контролем) — доступ до чужого workspace (A01
  Broken Access Control).** Кожен id у новому `agentIds` (shall) резолвитись
  через `agents.getById(workspaceId, id)` (AC-11) — той самий workspace-
  scope, що вже застосований для одиночного `agentId`; жодного `agent_runs`
  рядка (shall) не створюватись, доки НЕ ВСІ id резолвлені (AC-12) — немає
  часткового витоку, чи існує агент "трохи" в чужому воркспейсі.
- **LOW → нейтралізовано перевикористанням — stored/reflected XSS у
  контенті знахідок (A05 Injection, ASI09 Trust Exploitation).**
  `title`/`rationale`/`suggestion` — LLM-згенерований текст, потенційно з
  контентом, на який вплинув недовірений diff/PR-опис (injection guard —
  без змін, той самий `INJECTION_GUARD`/`wrapUntrusted()` шлях, ця спека не
  торкається `reviewer-core`). Columns/Tabs (shall) рендерити цей текст
  ВИКЛЮЧНО через уже наявні безпечні компоненти (`FindingCard`'s
  `<Markdown>`, `client/INSIGHTS.md` 2026-08-13 підтверджує: raw HTML →
  видимий текстовий вузол, не реальний DOM-елемент) — жодного нового
  `dangerouslySetInnerHTML` чи ручної конкатенації в DOM для кластерних
  карток/"Where agents disagree" рядків (короткі title рендеряться як
  звичайний React JSX text-child — авто-escape).
- **LOW — продуктивність кластеризації (не безпекова, але DoS-адʼяжна за
  великих обсягів).** Кластеризація AC-18 порівнює кожну пару findings
  групового прогону (`O(n²)` по кількості findings у групі). За типових
  обсягів (findings з одного PR, пройшли `groundFindings`-гейт) це
  тривіально дешево; якщо майбутній прогін матиме сотні findings на
  агента × кілька агентів, варто кепувати загальну кількість findings,
  залучених у кластеризацію (той самий "capped, не unbounded" принцип, що
  вже прийнятий у `repo-intel`'s `MAX_CALLERS_PER_SYMBOL`) — не блокує цю
  спеку, залишено як implementation-рівня NFR, не окремий AC.
- **LOW — логування.** Структурований лог конкурентного виконання (AC-13)
  (shall) нести лише `runId`/`agentId`/`multiAgentRunId`/duration/tokens/
  cost/findings — НІКОЛИ прозовий текст findings/prompt content — той
  самий принцип, що вже прийнятий `PROMPT_LOG_VERBOSE`-конвенцією
  (root `CLAUDE.md`) і незмінений цією спекою.
- **Прозорість вимірів (успадковано, не нове).** Score/грaundinг/findings
  count кожного агента групи (shall) відображатись per-agent, ніколи
  згорнутими в один "груповий score" — груповий прогін — це N незалежних
  оцінок поруч, не нова агрегатна метрика.

## Inputs and provenance

- **Список агентів + `avg_cost_usd`/`avg_latency_ms`** — вже наявні
  `GET /agents`/`GET /agents/:id/stats`, нуль нового джерела.
- **`multi_agent_runs`/`agent_runs.multi_agent_run_id`** — нові persisted
  метадані групування, записувані сервером у момент `runReview` (AC-14) —
  не зовнішній вхід, детермінований самим запитом.
- **Кластери знахідок / "Where agents disagree"** — обчислюються на льоту
  з уже персистованих `findings`+`reviews` (через `reviewsForPull`), жодне
  нове джерело даних.
- **Diff / PR опис / інтент** — той самий шлях, що вже є для одноagентного
  прогону (`run-executor.ts`); ця спека не додає нового вхідного джерела
  до самого review-пайплайну, лише запускає його N разів конкурентно.

## Untrusted inputs

- **Diff / PR body / PR коментарі** — без змін: той самий `INJECTION_GUARD`
  + `wrapUntrusted()` шлях у `reviewer-core/src/prompt.ts`, незалежний від
  того, скільки агентів запускається одночасно. Ця спека НЕ торкається
  `reviewer-core`.
- **`Finding.title`/`rationale`/`suggestion` (LLM-згенеровані, кожен
  агент — незалежне джерело)** — рендеряться в нових Columns/Tabs/"Where
  agents disagree" UI ВИКЛЮЧНО через уже безпечні примітиви
  (`FindingCard`'s `<Markdown>` для rationale/suggestion, звичайний
  React-текст для коротких title/verdict-рядків) — жодного нового шляху
  парсингу/рендеру недовіреного тексту.
- **`agentIds` (тіло запиту клієнта)** — це список UUID, що обирає
  ЦІЛІ виконання (не контент, що потрапляє в промпт) — недовіра тут суто
  access-control-класу (AC-11/AC-12: кожен id мусить резолвитись у
  воркспейс викликача ДО будь-якого запису в БД чи LLM-виклику), не
  injection-класу.

## Open questions

- **"Start New Review", поки попередній груповий прогін того самого PR ще
  має `running` job'и** — **вирішено користувачем**: дозволити без
  попередження/блокування (той самий "без confirm-діалогу" принцип, що вже
  прийнятий SPEC-06 для Restore). AC-3 завжди показує найновішу групу —
  старша просто перестає бути видимою на цій вкладці, хоча її job'и
  продовжують виконуватись і персистуються.
- **Точний UI Configure run screen (верстка, не поведінка)** — дизайн-
  мокап не містить артборду для нього (підтверджено користувачем явно).
  AC-5–AC-9 фіксують поведінку; піксельна верстка — рівень Development
  Plan/implementation, не цієї спеки.
- **Кепування кластеризації за обсягом findings** (NFR "продуктивність
  кластеризації") — конкретне число (MAX) не зафіксоване тут навмисно;
  рівень Development Plan, якщо профілювання покаже реальну потребу.
- **Чи слід ретроактивно позначити ВЖЕ ІСНУЮЧІ минулі `all:true`-прогони
  (до цієї спеки) `multi_agent_run_id`** — **вирішено користувачем: ні**.
  Ця спека створює групування лише ДЛЯ НОВИХ викликів `runReview` після
  деплою; історичні `agent_runs` рядки з кількома агентами тієї самої PR
  того самого моменту (без явного групового id) лишаються без
  `multi_agent_run_id` (null) — без backfill-міграції для demo/seed-даних.

## Task checklist

- [ ] T1 Контракти: `RunRequest` — новий `agentIds` (AC-10); `RunSummary` —
      новий `multi_agent_run_id` (AC-17); `ReviewRunResponse` — новий
      `run_group_id` (AC-16). Обидві копії `vendor/shared/contracts/`
      (`platform.ts`, `trace.ts`, `review-api.ts`), server і client, синхронно
      (root `INSIGHTS.md` 2026-07-31 dual-copy gotcha) → AC-10, AC-16, AC-17 →
      `server/test/contracts.test.ts` (нові поля парсяться, старі payload'и
      без них теж парсяться — nullable/optional)
- [ ] T2 DB: нова migration (`pnpm db:generate`, ніколи рукописна) —
      `agent_runs.multi_agent_run_id` (uuid, nullable,
      `references(() => multiAgentRuns.id, {onDelete: 'set null'})`) →
      AC-14, AC-15 → розширений `server/test/reviews-multi-agent.it.test.ts`
      (колонка існує, `onDelete: 'set null'` не валить видалення групи)
- [ ] T3 Сервер: `ReviewService.resolveTargets` — нова гілка `agentIds`
      (workspace-scoped резолюція, 404 до будь-якого запису при відсутньому
      id) → AC-11, AC-12 → новий `server/test/reviews-multi-agent.test.ts`
      (юніт, мокований repo: 404 на невідомий/чужий id ДО insertReview)
- [ ] T4 Сервер: `ReviewService.runReview` — створення `multi_agent_runs`
      рядка й запис `multi_agent_run_id` на кожен `agent_runs` коли
      `targets.length > 1`; `run_group_id` у відповіді → AC-14, AC-15,
      AC-16 → `server/test/reviews-multi-agent.it.test.ts` (2 агенти →
      один `multi_agent_runs` рядок, обидва `agent_runs` лінковані; 1 агент
      → `null`)
- [ ] T5 Сервер: `ReviewRunExecutor.executeRuns` — послідовний `for` →
      конкурентне виконання (`Promise.allSettled`-подібний паттерн), той
      самий per-job try/catch і `runLog`-fan-out незмінні → AC-13, AC-31 →
      розширений `server/test/reviews-multi-agent.it.test.ts` (2 агенти,
      один з мокованим LLM-затримкою/помилкою — обидва завершуються, один
      failed не блокує другий; опційно — таймінг-асерт, що виконання не
      послідовне)
- [ ] T6 Сервер: `findings-cluster.ts` (новий, чиста функція, без DB) —
      кластеризація по `file`+перетину `[start_line, end_line]`±2
      (AC-18) → AC-18, AC-19, AC-20 → новий
      `server/test/findings-cluster.test.ts` (юніт: перетин/± 2 рядки
      кластерує, різні файли — ні; кластер зберігає всі оригінальні
      findings з атрибуцією)
- [ ] T7 Сервер: `GET /pulls/:id/runs` — заповнити нове поле
      `multi_agent_run_id` у вже наявному `listRunsForPull` (без нового
      роута) → AC-17 → розширений існуючий тест `reviews.it.test.ts`/новий
      `reviews-multi-agent.it.test.ts`
- [ ] T8 Клієнт: `useRunReview` — новий `agentIds`-параметр у тілі запиту
      (`reviews.ts:141-145`); новий чистий `groupRuns`-подібний хелпер, що
      групує `RunSummary[]` за `multi_agent_run_id`, найновіша група першою
      → AC-9, AC-17 → новий тест хелпера (client, юніт)
- [ ] T9 Клієнт: новий `_components/MultiAgentReviewTab/` — порожній
      стан+"Start New Review" / показ останньої групи (T8's хелпер) →
      AC-1, AC-2, AC-3, AC-4 → новий `MultiAgentReviewTab.test.tsx`
- [ ] T10 Клієнт: новий `_components/ConfigureRunScreen/` — чекбокси по
      кожному агенту (дефолт = `enabled`), оцінка вартості/часу
      (`useAgentStats` на кожного позначеного, сума/max), кнопка "Run
      multi-agent review (N)" (disabled на 0) → AC-5, AC-6, AC-7, AC-8,
      AC-9 → новий `ConfigureRunScreen.test.tsx`
- [ ] T11 Клієнт: новий `_components/ColumnsView/` — картка на run
      (`CircularScore`/`RunCostBadge`/статус-бейдж/findings-список/View
      trace), 4с polling через `usePrRuns` (без нового SSE) → AC-25,
      AC-26, AC-27, AC-31 → новий `ColumnsView.test.tsx`
- [ ] T12 Клієнт: новий `_components/TabsDetailView/` — таб на агента
      (score-бейдж у табі), summary, перевикористаний список `FindingCard`
      (фільтрований на findings цього run) → AC-25, AC-28, AC-29 → новий
      `TabsDetailView.test.tsx` (Learn/Reply-to-author НЕ рендеряться —
      той самий `FindingCard`, без нової перевірки, тест лише фіксує це
      явно регресійно)
- [ ] T13 Клієнт: новий `_components/AgentsDisagreeSection/` — на основі
      T6's кластерів (клієнт отримує їх від сервера — див. T14), рядок на
      кластер×агент, "did not flag"/"pending"/"failed" гілки, перемикач
      "Show only conflicts" (дефолт off) → AC-21, AC-22, AC-23, AC-24 →
      новий `AgentsDisagreeSection.test.tsx`
- [ ] T14 Сервер: новий ендпоінт чи розширення існуючого
      `GET /pulls/:id/reviews` (query `run_ids=...`) — повертає
      персистовані reviews+findings ЗВУЖЕНІ до конкретного набору run_ids
      (для Columns/Tabs/"Where agents disagree" однієї групи, T6's
      кластери, обчислені серверною чистою функцією з T6 і повернуті
      разом) → AC-19, AC-20, AC-21 → розширений
      `server/test/reviews-multi-agent.it.test.ts` (звужена відповідь
      містить лише findings запитаних run_ids + кластери)
- [ ] T15 Клієнт: підключити "View trace" з ColumnsView/TabsDetailView до
      вже наявного `?trace=<runId>` на PR-сторінці (той самий
      `RunTraceDrawer`, нуль форку) → AC-30 → розширений
      `MultiAgentReviewTab.test.tsx` (клік View trace встановлює
      `?trace=`)
- [ ] T16 i18n: нові ключі під `client/messages/en/prReview.json` (чи
      сусідній неймспейс) для всіх нових написів (Start New Review,
      Configure run, Show only conflicts, did not flag, pending, тощо) →
      жоден новий AC (лише i18n) → покривається тестами T9-T13 (кожен
      робить свій `getByText`/`getByRole`)
