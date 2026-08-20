# Spec: Skill Editor — сторінка редактора скіла (Config/Context/Preview/Evals/Stats/Versions)
Spec ID: SPEC-06
Status: implemented — усі 11 кроків Development Plan
(промотовано в `docs/plans/spec-06-skill-editor.md`, робоча копія була
`.claude/plans/skill-editor.md`) виконано й верифіковано
(`plan-verifier`/`architecture-reviewer`, без critical/major знахідок).
Усе позначене `[NEEDS CLARIFICATION]` нижче лишається рівня Development
Plan (за прецедентом SPEC-05's Open questions) — жодне не заблокувало
реалізацію.
Supersedes: жодного попереднього `SPEC-NN` не замінює. Закриває конкретний
пробіл, який курс-фідбек на SPEC-05 назвав явно: «SkillEditor залишився без
вкладки Evals» — SPEC-05 свідомо позначила skill-owner eval UI як Non-goal
(`eval_cases.owner_kind` дозволяє `'skill'` у схемі, але жодна UI/route
SPEC-05 їх не обслуговувала). Ця спека НЕ скасовує те рішення для
workspace-рівневого Eval Dashboard (`/eval-dashboard` лишається
agent-only, AC-20 нижче) — вона додає ОКРЕМИЙ, скіл-скоуплений шлях до тих
самих даних, у новій вкладці Evals нового `/skills/:id`.

## Реконсиляція зі стартовим станом

Дослідницька сесія, що передувала цій спеці, зафіксувала «стартовий стан» із
кількома неточностями — перевірено `file:line` повторно перед написанням
AC, і **три пункти виявились застарілими/невірними**. Це не косметика: вони
міняють обсяг задачі з «збудувати з нуля» на «підключити наявне».

- **НЕ підтверджено: «`SkillsService.update()` не снепшотить
  `skill_versions` при зміні `body`».** Насправді
  `SkillsRepository.update()` (`server/src/modules/skills/repository.ts:77-104`)
  **вже** порівнює `patch.body` зі старим значенням, бампає `version` і
  викликає `snapshotVersion()` — точно той самий патерн, що
  `AgentsRepository.update`'s config-version-бамп. Реалізовано, робоче,
  не потребує фіксу. Залишається дійсно відсутнім: HTTP-роути, що
  ЕКСПОНУЮТЬ цю історію (`list`/`diff`/`restore`) — саме це є обсягом
  вкладки Versions нижче, не бекенд-фікс сервісу.
- **НЕ підтверджено: «немає HTTP-роутів чи UI для `skill_context_docs`».**
  `GET`/`POST /skills/:id/context-docs` **вже існують**
  (`server/src/modules/project-context/routes.ts:70-91`,
  `ProjectContextService.listSkillDocs`/`setSkillDocs`,
  `service.ts:138-179`), і UI **вже існує** — `SkillDrawer`'s секція
  «Project context to use» (`client/src/app/skills/_components/SkillDrawer/SkillDrawer.tsx:175-186`)
  вже рендерить спільний `ContextDocPicker` + «SERIALIZES AS»-прев'ю,
  підключений до `useSkillContextDocs`/`useSetSkillContextDocs`
  (`client/src/lib/hooks/skills.ts:69-90`). Обсяг вкладки Context у цій
  спеці — **перенести цей уже робочий UI-блок** із drawer'а в нову
  вкладку, не будувати сервер чи UI з нуля.
- **Підтверджено (без розриву): «SkillCard» stats-рядок з мокапу («3
  agents · 71% pull · 74% accept») — дійсно НЕ реалізований.** Фактичний
  `SkillCard.tsx` (`client/src/app/skills/_components/SkillCard/SkillCard.tsx`)
  рендерить лише name/description/type/source/vetting-бейдж — жодних
  метрик. Немає жодного серверного `skill-stats`-модуля чи агрегації
  (є лише `agents/stats-repository.ts`/`stats-helpers.ts`, чисто
  агент-центричні). Вкладка Stats нижче — **реальна нова робота**, не
  підключення наявного.

## Проблема й користувач

**Проблема.** `/skills` сьогодні — плаский список карток із drawer'ом
(`SkillDrawer`, 193 рядки, без вкладок) для перегляду/редагування одного
скіла. Немає жодного способу: (а) прогнати ізольований eval-набір ПРОТИ
самого скіла (без прив'язки до конкретного продакшн-агента), (б) побачити
скіл-центричні метрики (хто його використовує, наскільки часто, яка
accept-rate знахідок, породжених саме через нього), (в) переглянути історію
версій `body` скіла чи відкотитись до попередньої. `AgentEditor`
(`/agents/:id`) уже має цю форму — вкладки, `?tab=`-стан, окремий маршрут —
для агентів; скіли лишаються на попередньому, менш потужному рівні
взаємодії.

**Користувач.** Той самий власник агента/скіл-автор (SPEC-05's «власник
агента»), який після написання чи імпорту скіла хоче: перевірити його
ізольовано (чи справді ловить/не ловить те, що обіцяє), побачити, чи скіл
взагалі кимось використовується і чи він «шумний» (низька accept rate
знахідок), і мати змогу відкотити необережну правку `body`.

## Goals / Non-goals

**Goals**

- G1. Новий маршрут `/skills/:id` (тонкий `page.tsx` → `_components/SkillEditorView`),
  що структурно дзеркалить `/agents/:id`/`AgentEditor`: 6 вкладок (Config,
  Context, Preview, Evals, Stats, Versions), стан вкладки в `?tab=`, той
  самий `VALID_TABS`-guard проти "тихого fallback на невалідний tab", що
  вже виправлений для агентів (`AgentEditorPage.tsx:16-21`). `SkillsListView`'s
  картки ведуть на цей маршрут замість відкриття `SkillDrawer` в режимі
  `"edit"` — `SkillDrawer` лишається ТІЛЬКИ для `"create"`/`"import"`
  (немає `id` до персистування, маршрут не може існувати заздалегідь);
  успішний create/import веде на `/skills/{id}?tab=config` замість простого
  закриття (той самий патерн, що `CreateAgentModal.tsx:32`).
- G2. Вкладка Config — переносить (не переписує з нуля) поля `SkillDrawer`'s
  `"edit"`-режиму (name/description/type/body/enabled/version-бейдж/
  untrusted-notice), плюс новий token-count індикатор на `body`
  (перевикористовує вже наявну формулу `approxTokens(chars) = Math.ceil(chars/4)`,
  `client/src/lib/hooks/project-context.ts:70-75` — той самий підхід, що
  вже показаний у `ContextDocPicker`, не нова евристика).
- G3. Вкладка Preview — рендерить `skill.body` через уже наявний
  `<Markdown>` (`@devdigest/ui`, той самий компонент, що `FindingCard`/
  `ProjectContextPage` вже використовують), read-only, без textarea.
- G4. Вкладка Context — переносить (unchanged) `SkillDrawer`'s наявний блок
  `ContextDocPicker` + «SERIALIZES AS» прев'ю. **Нуль змін на сервері** —
  `GET`/`POST /skills/:id/context-docs` і run-time merge
  (`ProjectContextService.resolveAgentContext`) вже коректні й незмінні.
- G5. Вкладка Evals — той самий вигляд, що `AgentEditor`'s `EvalsTab`
  (MUST FIND/MUST NOT FLAG бейджі, «Run all», «New eval case», історія
  сет-ранів + Compare), але для `owner_kind: 'skill'`. Прогін ізольовано
  тестує САМ скіл: фіксований генеричний system prompt + лише цей один
  скіл у `skills`, без інших лінкованих скілів чи реального агента —
  бекенд-механізм і його обґрунтування нижче (Evals-розділ AC).
- G6. Вкладка Stats — Used by (кількість агентів) / Pull frequency /
  Accept rate / «Agents using this skill» список / «Findings by category»
  донат **у $ (cost, атрибутований на знахідки цієї категорії)**, не в
  сирій кількості — цифри з мокапу (dollar signs) буквальні, не помилка
  мокапу.
- G7. Вкладка Versions — список версій (найновіші перші, з уже наявної
  `skill_versions`), Diff між двома обраними (перевикористовує
  `diffPromptLines`, промотований з `CompareRunsModal/helpers.ts` у
  спільний шар), Restore (пише обраний `body` назад у `skills.body` через
  наявний `PUT /skills/:id` — це своєю чергою бампає версію й знову
  снепшотить, бо `body` реально змінюється; жодного нового мутаційного
  шляху на сервері для самого запису).

**Non-goals**

- **Community search drawer / маркетплейс** (пошук/імпорт скілів із
  зовнішніх публічних репозиторіїв) — поза обсягом. Причина: окремий,
  значно більший периметр (зовнішня інтеграція, довіра/валідація
  стороннього контенту, rate-limit на зовнішній API) — відкладено до
  майбутньої спеки. `SkillsListView`'s пункт меню `"page.menu.community"`
  лишається `muted` (уже так сьогодні,
  `client/src/app/skills/_components/SkillsListView/SkillsListView.tsx:66`)
  — без змін.
- **Скіл-кейси на workspace-рівневому Eval Dashboard (`/eval-dashboard`)
  чи його per-agent drill-down (`/eval-dashboard/:agentId`)** — обидва
  лишаються agent-only, за вже встановленим Non-goal SPEC-05. Ця спека
  НЕ перевідкриває те рішення (AC-20).
- **Community search drawer's "vetting"/схвалення воркфлоу** — не
  специфіковано тут (той самий Non-goal, що вище).
- **Нова серверна модель "system agent"-рядка в `agents`-таблиці для
  прогону скіл-евалів** — явно відхилено (обґрунтування — AC-14): замість
  цього прогін конструює конфіг in-memory на кожен виклик, нічого не
  персистується в `agents`.
- **Per-run override провайдера/моделі для скіл-евалів** (окремий параметр
  запиту) — відхилено на користь того самого патерну, що вже
  використовують УСІ інші системні LLM-фічі (`onboarding`/`review_intent`/
  `risk_brief`/`conventions`): `resolveFeatureModel(container, workspaceId, id)`,
  вибір живе лише в Settings воркспейсу, не в тілі запиту. Жоден наявний
  роут (`POST /repos/:id/conventions/extract`, `POST /pulls/:id/brief`,
  тощо) не приймає `provider`/`model` в тілі — вводити цей прецедент
  вперше саме тут було б непослідовно.
- **Runtime-merge логіка Project Context** (`resolveAgentContext`) — без
  змін, уже коректна (SPEC-01/SPEC-02).
- **Перевірка якості self-vetting** (чи власник скіла справді уважно
  прогнав eval-набір перед тим як увімкнути скіл) — не мітигується
  технічно, той самий клас Non-goal, що SPEC-05's "ground truth
  verification".

## User stories

- Як автор скіла, я відкриваю `/skills`, клікаю картку — потрапляю на
  `/skills/{id}` замість drawer'а, бачу 6 вкладок так само, як в
  `AgentEditor`.
- Як той самий автор, я редагую `body` скіла у вкладці Config, бачу
  оновлюваний token-count поки друкую, зберігаю — версія бампається
  автоматично (вже так сьогодні).
- Як той самий автор, я відкриваю вкладку Preview — бачу відрендерений
  markdown точно так, як його побачить модель, без можливості випадково
  його відредагувати тут.
- Як той самий автор, я відкриваю вкладку Evals, бачу набір eval-кейсів
  цього скіла, тисну «Run all» — прогін виконується проти ІЗОЛЬОВАНОГО
  конфігу (лише цей скіл, генеричний system prompt), бачу recall/precision/
  citation_accuracy — так само, як для агента, без потреби прив'язувати
  скіл до реального продакшн-агента заради тесту.
- Як той самий автор, я відкриваю вкладку Stats, бачу «Used by 3 agents ·
  71% pull · 74% accept» і донат «Findings by category» в доларах — і
  розумію, чи цей скіл взагалі корисний, до того як вимикати/видаляти
  його.
- Як той самий автор, я відкриваю вкладку Versions, бачу історію правок
  `body`, обираю дві версії — бачу diff, тисну Restore на старій —
  `body` відкочується, і в історії з'являється НОВА версія з відкоченим
  вмістом (не перезапис старого запису).

## Acceptance criteria (EARS)

**Маршрут і вкладки (G1)**

- **AC-1** (ubiquitous). Система (shall) рендерити `/skills/:id` через
  тонкий `page.tsx`, що делегує `SkillEditorView`, з 6 вкладками (Config,
  Context, Preview, Evals, Stats, Versions), станом вкладки в `?tab=`, і
  тим самим `VALID_TABS`-guard'ом проти невалідного `?tab=`, що вже
  застосований `AgentEditorPage.tsx:16-21` (похідний від `TABS`, а не
  окремо підтримуваний список).
- **AC-2** (event-driven). КОЛИ користувач клікає картку скіла в
  `SkillsListView`, система (shall) перейти на `/skills/{id}` (замість
  попереднього `router.push(\`/skills?skillId=${id}\`)`, що відкривало
  `SkillDrawer` в режимі `"edit"`) — гілка `mode === "none" && selectedId`
  у `SkillsListView.tsx:37-39` (shall) бути видалена.
- **AC-3** (unwanted behavior). ЯКЩО `:id` не резолвиться в скіл
  воркспейсу викликача (`GET /skills/:id` → 404), ТО сторінка (shall)
  показати `ErrorState` (той самий компонент і той самий патерн, що
  `AgentEditorPage.tsx:46-57`), не порожній чи зламаний рендер.
- **AC-4** (ubiquitous). `SkillDrawer` (shall) лишитись єдиним шляхом для
  режимів `"create"`/`"import"`; режим `"edit"` (shall) бути видалений із
  компонента. Успішний `submit()` для `"create"`/`"import"` (shall)
  викликати `router.push(\`/skills/${skill.id}?tab=config\`)` замість
  `onClose()`.

**Config tab (G2)**

- **AC-5** (ubiquitous). Вкладка Config (shall) показувати ті самі поля,
  що `SkillDrawer`'s `"edit"`-режим показував (name/description/type/body/
  Enabled toggle/версійний бейдж `"v{version}"`), плюс token-count напис
  поруч із `body`-редактором, обчислений через `approxTokens(body.length)`.
- **AC-6** (ubiquitous). Untrusted-notice банер (shall) рендеритись у
  вкладці Config за тією самою умовою, що вже діє в `SkillDrawer`
  (`existing.source !== "manual" && !existing.enabled`,
  `SkillDrawer.tsx:105,140-142`) — без зміни самої умови.
- **AC-7** (event-driven). КОЛИ користувач зберігає Config зі зміненим
  `body`, система (shall) персистувати через наявний `PUT /skills/:id`
  (без жодної нової серверної мутації) — версійний бамп+снепшот
  (`skill_versions`) відбувається автоматично, вже реалізованою логікою
  `SkillsRepository.update()`.

**Preview tab (G3)**

- **AC-8** (event-driven). КОЛИ користувач відкриває вкладку Preview,
  система (shall) відрендерити поточний `skill.body` через `<Markdown>`
  (`@devdigest/ui`), без textarea чи будь-якого редагованого поля.
- **AC-9** (ubiquitous). Вкладка Preview (shall) бути суто read-only —
  редагування `body` доступне лише через вкладку Config.

**Context tab (G4)**

- **AC-10** (ubiquitous). Вкладка Context (shall) містити той самий блок
  `ContextDocPicker` + «SERIALIZES AS» прев'ю, перенесений з
  `SkillDrawer`'s `"edit"`-режиму без зміни поведінки, підключений до вже
  наявних `useSkillContextDocs(skillId)`/`useSetSkillContextDocs(skillId)`.
- **AC-11** (ubiquitous). Жодна поведінка attach/detach/reorder,
  дедуплікації чи run-time резолюції (SPEC-01 AC-7/AC-9/AC-10/AC-15,
  SPEC-02 AC-24-26) (shall) не змінюватись цією спекою — Context tab є
  чисто UI-переносом уже коректного шляху.

**Evals tab — ізольований прогін скіла (G5)**

- **AC-12** (ubiquitous). `EvalsService`'s методи (`list`/`create`/
  `update`/`delete`/`run`/`runSet`/`listSetRuns`) (shall) прийняти
  параметр `ownerKind: 'agent' | 'skill'` і диспатчити на нього — той
  самий вже owner-kind-агностичний `EvalsRepository` (перевірено:
  `listByOwner`/`listSetRunsByOwner`/`caseCountsByOwner`/`allSetRuns` уже
  приймають `ownerKind` параметром, `server/src/modules/evals/repository.ts:50-54,156-160,179-183,192-195`)
  — жодних змін у репозиторії не потрібно, лише в сервісі й роутах.
- **AC-13** (ubiquitous). Нові роути (shall) дзеркалити наявні agent-роути
  1:1 за формою: `GET/POST /skills/:id/evals`, `PUT/DELETE
  /skills/:id/evals/:caseId`, `POST /skills/:id/evals/:caseId/run`,
  `GET/POST /skills/:id/eval-runs`.
- **AC-14** (ubiquitous) — **ключове дизайн-рішення цієї спеки, не
  hand-waved.** КОЛИ прогоняється skill-owned eval-кейс (одиничний чи
  bulk), система (shall) побудувати конфіг прогону БЕЗ реального
  персистованого агента — **синтетичний in-memory об'єкт**, структурно
  сумісний із вузьким типом `{ provider: Provider; model: string;
  systemPrompt: string }` (звужений тип для першого параметра
  `EvalsService`'s приватного `executeCase()`, замість поточного
  `AgentRow` — `executeCase` реально читає лише `provider`/`model`/
  `systemPrompt` із цього об'єкта, `server/src/modules/evals/service.ts:168-216`,
  тож звуження типу безпечне й `AgentRow` й надалі задовольняє його
  структурно):
  - `systemPrompt` = фіксована константа `SKILL_EVAL_SYSTEM_PROMPT`
    (нова, `server/src/modules/evals/` чи сусідній файл):
    `"You are a code reviewer testing a single skill in isolation. Review the diff strictly according to the attached skill's rules below — do not invent additional conventions, and do not suppress findings the skill's rules would flag. Report every issue the skill instructs you to catch, with file, line range, severity, and category, exactly as your normal reviewer output format requires."`
  - `skills` (для `reviewPullRequest`) = масив з РІВНО ОДНИМ елементом —
    `[skillUnderTest.body]`. Жодних інших лінкованих скілів, жодного
    repo-intel — той самий "ізольована fixture-diff" принцип, що вже
    діє для агентських eval-кейсів (`service.ts:222-223`'s doc-comment).
  - `provider`/`model` = `resolveFeatureModel(container, workspaceId,
    'skill_eval')` — нова умова `FeatureModelId` (T6), той самий
    механізм, що `onboarding`/`review_intent`/`risk_brief`/
    `conventions` уже використовують
    (`server/src/modules/settings/feature-models.ts:51-57`).
  **Обґрунтування вибору "синтетичний об'єкт" проти "лишній персистований
  system-агент":** `executeCase` вже структурно потребує лише 3 поля;
  персистований system-агент означав би нову таблицю/рядок, що
  засмічував би список агентів воркспейсу, з'являвся в
  `AgentsService.list()`/Eval Dashboard/Stats скрізь, де сервіс ітерує
  `agents`-таблицю — а AC-20 explicit вимагає, щоб скіл-еваллинг НЕ
  протікав у ці агент-центричні поверхні. Синтетичний об'єкт — нуль
  нових рядків, нуль ризику витоку в невідповідні списки.
- **AC-15** (unwanted behavior). ЯКЩО скіл під тестом має `enabled: false`
  (невичищений імпорт чи навмисно вимкнений), ТО прогін (shall) все одно
  виконатись з його поточним `body` — прапорець `enabled` НЕ фільтрує
  скіл-під-тестом (на відміну від того, як `enabled` фільтрує ЛІНКОВАНІ
  скіли агента при звичайному прогоні, `service.ts:236,263`). Це і є сенс
  вкладки: перевірити скіл ДО того, як вмикати його на реальному агенті.
- **AC-16** (ubiquitous). Рядки `eval_runs`, породжені скіл-прогоном,
  (shall) записувати `system_prompt_snapshot = SKILL_EVAL_SYSTEM_PROMPT`
  (та сама вже наявна nullable-колонка, без нової міграції).
- **AC-17** (ubiquitous). UI вкладки Evals (shall) перевикористовувати
  ТОЙ САМИЙ компонент, що `AgentEditor`'s `EvalsTab` (MUST FIND/MUST NOT
  FLAG бейджі, «Run all», «New eval case», список історії + Compare,
  `METRIC_COLOR`, `groupRuns`/`caseTransitions`/`toggleRunSelection`),
  промотований у параметризовану `{ ownerKind, ownerId }`-форму замість
  жорстко закодованого `agentId` — другий викликач з ІНШОГО фіче-дерева є
  тим самим "promote on second user"-тригером, що вже промотував
  `EvalCaseModal` у `client/src/components/eval-case-modal/`
  (client/INSIGHTS.md 2026-08-19).
- **AC-18** (unwanted behavior — cost abuse). `POST /skills/:id/eval-runs`
  (shall) нести той самий rate limit `{max: 5, timeWindow: '1 minute'}`,
  що вже застосований `POST /agents/:id/eval-runs` (SPEC-05 AC-22) — той
  самий клас загрози (bulk фан-аутить до N LLM-викликів за один HTTP
  запит).
- **AC-19** (unwanted behavior — access control). ЯКЩО `:id` скіла (будь-
  який з нових skill-eval роутів) не належить воркспейсу викликача, ТО
  система (shall) повернути 404 ДО будь-якого LLM-виклику чи запису в БД
  — той самий патерн, що SPEC-05 AC-23.
- **AC-20** (ubiquitous). Workspace-рівневий Eval Dashboard
  (`GET /eval-dashboard`) і per-agent drill-down
  (`/eval-dashboard/:agentId`) (shall) лишитись agent-only — жоден
  skill-owned eval-кейс чи set-run (shall) не з'являтись у жодному з цих
  двох поверхонь. Не новий AC по суті — явне підтвердження вже
  встановленого SPEC-05 Non-goal, не перевідкрите цією спекою.
- **AC-21** (ubiquitous). `EvalCaseModal` (shall) працювати без змін для
  skill-owned кейсів (`owner_kind: 'skill'`, `owner_id: skillId`) — той
  самий компонент, лише інший `ownerKind`/`ownerId`, переданий йому
  замість `agentId`.

**Stats tab (G6)**

- **AC-22** (event-driven). КОЛИ користувач відкриває вкладку Stats,
  система (shall) показати: `used_by_agents` (число), `pull_rate`
  (відсоток або "—"), `accept_rate` (відсоток або "—"), список «Agents
  using this skill», і донат «Findings by category» в доларах (`$`, не
  сирій кількості).
- **AC-23** (ubiquitous). `used_by_agents` (shall) дорівнювати кількості
  РІЗНИХ агентів, що НАРАЗІ лінкують цей скіл через `agent_skills`
  (пряме, не time-windowed прикріплення) — той самий "direct attachment,
  не транзитивний" принцип, що вже прийнятий для «Used by N agents» на
  сторінці Project Context (SPEC-01/SPEC-02).
- **AC-24** (ubiquitous). `pull_rate` (shall) дорівнювати: (кількість
  `'done'`-прогонів за останні 30 днів, що належать агентам, які НАРАЗІ
  лінкують цей скіл, чий `agent_runs.skill_ids` містить id цього скіла) /
  (загальна кількість таких прогонів тих самих агентів у тому самому
  вікні) — `null`, коли знаменник дорівнює 0 (скіл нікому не лінкований,
  або лінкований агентам без жодного завершеного прогону за 30 днів) —
  НЕ подається як `0%`.
- **AC-25** (ubiquitous). `accept_rate` (shall) дорівнювати
  `accepted / (accepted + dismissed)` серед знахідок, що належать
  рев'ю прогонів, У ЯКИХ цей скіл РЕАЛЬНО був підтягнутий
  (`skill_ids` містить його), за останні 30 днів — `null`, коли немає
  жодної знахідки з прийнятим рішенням (той самий "vacuous null, не 0"
  принцип, що `AgentStats.accept_rate`, `stats-helpers.ts:99`).
- **AC-26** (ubiquitous) — **атрибуція cost на категорію, явне
  рішення.** Для кожного прогону з набору AC-24 (skill_ids містить цей
  скіл, 30-денне вікно, `costUsd`/`findingsCount` не `null`), система
  (shall) розподілити `costUsd` рівномірно між ЙОГО ВЛАСНИМИ знахідками
  (`costUsd / findingsCount` на знахідку) і засумувати цей внесок за
  `category` кожної знахідки. Прогін без жодної знахідки або з
  `costUsd === null` (shall) не додавати нічого (не `NaN`, не поділ на
  нуль). **Явно відхилена альтернатива:** приписувати ПОВНИЙ `costUsd`
  прогону КОЖНІЙ категорії, представленій серед його знахідок —
  відхилено, бо сума атрибутованих категорій тоді перевищувала б реальні
  витрати прогону; рівномірний розподіл зберігає інваріант "сума по
  категоріях = сума `costUsd` прогонів набору".
- **AC-27** (unwanted behavior). ЯКЩО скіл ще не лінкований жодному
  агенту, ТО вкладка Stats (shall) показати порожній/нульовий стан
  (`used_by_agents: 0`, `pull_rate: null`, `accept_rate: null`, порожній
  список агентів, порожній донат) без падаючого запиту — той самий
  "Never run" принцип, що `AgentStats`/Eval Dashboard AC-21 (SPEC-05).

**Versions tab (G7)**

- **AC-28** (event-driven). КОЛИ користувач відкриває вкладку Versions,
  система (shall) показати список усіх рядків `skill_versions` цього
  скіла через новий `GET /skills/:id/versions`, найновіші перші (та сама
  сортировка, що вже наявний `SkillsRepository.listVersions`,
  `repository.ts:115-121`).
- **AC-29** (event-driven). КОЛИ користувач обирає рівно дві версії,
  система (shall) показати лінійний diff між їхніми `body` — перевикористовуючи
  `diffPromptLines`/`PromptDiffLine`, промотований із
  `client/src/app/eval-dashboard/[agentId]/_components/CompareRunsModal/helpers.ts`
  у новий спільний модуль `client/src/lib/text-diff.ts` (не `eval-runs.ts`
  — ця утиліта не про eval-прогони; окремий "другий викликач з іншого
  фіче-дерева" тригер промоції, той самий "promote on the second user"
  принцип, застосований до ІНШОЇ функції в цьому ж наборі AC).
- **AC-30** (event-driven). КОЛИ користувач тисне Restore на версії V,
  система (shall) викликати наявний `PUT /skills/:id` з `{body: V.body}`
  — жодного нового мутаційного роуту. Оскільки `V.body` типово ВІДРІЗНЯЄТЬСЯ
  від поточного `skills.body`, наявна логіка `SkillsRepository.update()`
  (shall) природньо забампати версію й записати НОВИЙ снепшот у
  `skill_versions` — Restore НЕ перезаписує стару версію і НЕ видаляє
  версії між V і поточною; історія лишається лінійною, з новим записом у
  хвості.
- **AC-31** (unwanted behavior). ЯКЩО `V.body` дорівнює поточному
  `skills.body` (no-op Restore — користувач "відновлює" вже активну
  версію), ТО жодна нова версія (shall) не створюватись — той самий вже
  наявний `bodyChanged`-guard (`repository.ts:85`), без додаткової
  клієнтської перевірки.
- **AC-32** (ubiquitous). `GET /skills/:id/versions` (shall) бути
  workspace-scoped — сервісний шар (shall) перевірити належність скіла
  `workspaceId` ДО виклику `repo.listVersions` (новий контроль на рівні
  сервісу; наявний `SkillsRepository.listVersions(skillId)` сам по собі
  НЕ приймає `workspaceId`) — 404, коли скіл не в цьому воркспейсі, той
  самий патерн, що `ProjectContextService.listSkillDocs`
  (`service.ts:138-142`).

## Edge cases

- Скіл під тестом (Evals tab) — імпортований, ще не звірений
  (`source !== 'manual'`, `enabled: false`) → прогін усе одно
  виконується на його поточному `body` (AC-15) — саме це і є мета
  вкладки; Config tab паралельно показує untrusted-notice банер (AC-6),
  тож користувач розуміє, ЩО саме він тестує.
- Набір eval-кейсів скіла порожній на момент `POST /skills/:id/eval-runs`
  → AC-13 (нові роути дзеркалять agent-роути 1:1, включно з наявною
  422-поведінкою SPEC-05 AC-13 для порожнього набору) — перевикористана
  логіка `runSet`, не новий код.
- Скіл видалено, поки вкладка Versions відкрита в іншій вкладці браузера
  → `skill_versions.skill_id` має `onDelete: 'cascade'`
  (`server/src/db/schema/skills.ts:28`) — наступний `GET
  /skills/:id/versions` (AC-32) повертає 404 (скіл не знайдено), не
  порожній список чи 500.
- Restore на НАЙСТАРІШІЙ версії, чий `body` вже випадково збігається з
  поточним (наприклад користувач щойно вручну ввів той самий текст) →
  AC-31, без нового снепшота.
- Diff (AC-29) між двома версіями, одна з яких має порожній `body` —
  неможливо на практиці (`body` має `.min(1)` на створенні/апдейті скіла),
  але `diffPromptLines` вже толерантний до `null`/порожнього боку (не
  кидає) — жодного спеціального case не потрібно.
- Скіл лінкований кільком агентам, кожен з яких лінкує ЩЕ й ІНШІ скіли в
  тому самому прогоні → атрибуція cost (AC-26) розподіляє `costUsd`
  прогону лише за ЙОГО ВЛАСНИМИ знахідками, не намагаючись вирахувати
  "яка частка знахідок від якого саме скіла" — визнана, задокументована
  неточність (той самий стиль, що SPEC-05's "матчер не розуміє
  семантику" обмеження — фіксується явно, не ховається).
- Скіл лінкований агенту, але той агент за 30 днів жодного разу не
  прогнав завершений (`status: 'done'`) рев'ю → цей агент НЕ додає
  нічого до знаменника `pull_rate` (AC-24) — не помилка, просто нуль
  внеску від цього агента.
- Старий bookmarked URL `/skills?skillId={id}` (попередній спосіб
  відкрити drawer в режимі edit) після цієї спеки більше не відкриває
  жодного drawer'а (AC-2 видаляє цю гілку) — залишиться на голому
  `/skills` без помилки, просто без автовідкриття. Чи вартий редірект на
  `/skills/{id}` — `[NEEDS CLARIFICATION]`, див. Open questions.
- `POST /skills/:id/evals/:caseId/run` (одиничний прогін, не bulk) —
  той самий "без rate limit" пробіл, що SPEC-05 вже задокументувала й
  свідомо НЕ закрила для агентського еквівалента (SPEC-05 NFR,
  "Супутня знахідка, не частина обсягу") — тут той самий вибір: не
  закривається в обсязі цієї спеки, лише успадковується.

## Non-functional requirements

Пропущено через скіл `security` (OWASP Top 10:2025 / Agentic AI Security
ASI01/ASI09) — той самий обсяг перевірки, що вже застосований у SPEC-01/
SPEC-03/SPEC-04/SPEC-05 до їхніх LLM-викликів і недовіреного контенту.
Знахідки:

- **MEDIUM — cost abuse через bulk skill-eval-прогін (A06 Insecure
  Design).** `POST /skills/:id/eval-runs` фан-аутить до N LLM-викликів за
  один HTTP запит, той самий клас, що SPEC-05's `POST
  /agents/:id/eval-runs`. Мітигація — той самий rate limit `{max: 5,
  timeWindow: '1 minute'}` (AC-18), не слабший за прецедент.
- **HIGH → MEDIUM (за наявним контролем) — доступ до чужого workspace
  (A01 Broken Access Control).** Усі нові skill-eval-роути, `GET
  /skills/:id/versions`, і `POST /skills/:id/versions/:version/restore`
  (shall) перевіряти належність `:id` скіла воркспейсу викликача ДО
  будь-якого запису в БД чи LLM-виклику (AC-19, AC-32) — той самий
  вже наявний паттерн (`getContext` + `workspaceId`-фільтр), що кожен
  наявний роут `skills`/`evals`-модулів уже застосовує.
- **~~MEDIUM (успадкований, не новий)~~ ВИПРАВЛЕНО (2026-08-20, окремим
  фіксом поза обсягом SPEC-06) — довіра до тіла скіла без injection-guard'а
  в самій точці збірки промпту (ASI01 Goal Hijacking, ASI09 Trust
  Exploitation).** Було: `reviewer-core/src/prompt.ts:171` рендерив
  `## Skills / rules\n${skillsBlock}` БЕЗ `wrapUntrusted()` — на відміну
  від diff/PR-опису/callers/repo-map, які всі проходять через
  делімітер-обгортку; doc-comment сам визнавав це (`prompt.ts:58`, тепер
  теж виправлений). Фікс: `skillsBlock` тепер будується через
  `parts.skills.map((s, i) => wrapUntrusted(\`skill-${i}\`, s))`,
  дзеркалячи вже наявний `specsBlock`-патерн — `INJECTION_GUARD` і сама
  функція `wrapUntrusted()` не змінені (жодного нового/паралельного
  механізму захисту). Регресійний тест: `reviewer-core/test/prompt.test.ts`
  (`describe('assemblePrompt — ## Skills / rules (skills)')`). Evals tab
  (ця спека) лишається продуктовою мітигацією цього ж класу ризику
  (контрольована ізольована перевірка скіла до вмикання/лінкування) —
  тепер вже поверх технічно закритого розриву, не замість нього.
- **LOW — логування.** Структурований лог кожного skill-eval прогону
  (одиничного чи bulk) (shall) нести лише `caseId`/`skillId`/`runId`/
  `run_group_id`/резолвлений provider/model/`recall`/`precision`/
  `citation_accuracy`/`costUsd`/`durationMs` — НІКОЛИ прозовий текст
  `actual_output`/`SKILL_EVAL_SYSTEM_PROMPT`/`skill.body` — той самий
  принцип, що вже прийнятий SPEC-05's evals-логування і root
  `CLAUDE.md`'s `PROMPT_LOG_VERBOSE`-конвенція.
- **LOW — XSS у вкладці Preview (A05 Injection, ASI09).** `skill.body`
  (потенційно від `imported_url`/`community`-джерела, ще не звіреного)
  рендериться через `<Markdown>` — компонент уже підтверджено безпечний
  для довільного тексту, включно з буквальними `<script>`-тегами
  (client/INSIGHTS.md 2026-08-13: `react-markdown` без `rehype-raw`
  конвертує raw HTML у видимий текстовий вузол, не в реальний DOM-елемент)
  — жодного нового санітайзера не потрібно, вкладка Preview (shall)
  просто перевикористати цей уже безпечний компонент, не
  `dangerouslySetInnerHTML`.
- **Прозорість вимірів (не безпекова, але явна вимога курсу, успадкована
  з SPEC-05).** recall/precision/citation_accuracy (shall) НІКОЛИ не
  згортатись в один непрозорий score — той самий AC-24 SPEC-05,
  перевикористаний тим самим промотованим `EvalsTab`-компонентом
  (AC-17), не переспецифікований тут окремо.

## Inputs and provenance

- **Skill body, tokenCount** — `skills.body` (уже персистоване поле),
  токен-оцінка — чиста клієнтська функція з довжини рядка, жодного
  нового джерела.
- **Skill-eval прогін (Evals tab)** — `SKILL_EVAL_SYSTEM_PROMPT`
  (константа коду, не з БД, не від клієнта) + `skillUnderTest.body`
  (уже персистоване поле, читане ЗАВЖДИ незалежно від `enabled`, AC-15)
  + `resolveFeatureModel(container, workspaceId, 'skill_eval')`
  (workspace `settings`-рядок, той самий шлях, що вже читають чотири
  інші фічі) + eval-кейса `input_diff` (той самий шлях реконструкції чи
  ручного введення, що вже прийнятий SPEC-05 для агентських кейсів,
  нуль змін).
- **Stats tab** — обчислюється на льоту з уже наявних таблиць
  (`agent_skills`, `agent_runs.skill_ids`, `reviews.run_id`,
  `findings.category`/`accepted_at`/`dismissed_at`) — новий
  `SkillStatsRepository` (сервер), без нової персистованої агрегатної
  таблиці, той самий "compute on read" підхід, що `AgentStats`/Eval
  Dashboard.
- **Versions tab** — читає виключно вже наявну `skill_versions`, без
  нового джерела; Restore пише через уже наявний `PUT /skills/:id`.

## Untrusted inputs

- **`skill.body` (як контент, так і у skill-eval прогоні)** — той самий
  клас недовіри, що вже описаний для будь-якого імпортованого/community
  скіла (SPEC-01 lineage); ЦЯ спека не змінює, як `body` обробляється
  всередині `reviewer-core`'ового `assemblePrompt` — розрив, описаний
  вище, з 2026-08-20 вже технічно закритий окремим фіксом
  (`wrapUntrusted()` на `skillsBlock`); вкладка Evals лишається
  додатковою продуктовою мітигацією того ж класу ризику (контрольоване
  тестування ДО ввімкнення), не єдиним захистом.
- **Eval-кейса `input_diff` (skill-owned)** — той самий реальний PR-diff
  клас недовіри, що SPEC-05 вже задокументувала для агентських
  eval-кейсів; той самий `parseUnifiedDiff`/`wrapUntrusted('diff', ...)`
  шлях всередині `reviewPullRequest`, викликаний через ТОЙ САМИЙ
  `executeCase` — жодного нового, паралельного шляху конкатенації diff'а
  в промпт.
- **`actual_output` skill-eval прогону** — вихід LLM, персистується як
  є (той самий контракт, що вже наявний `EvalRunRecord`), НІКОЛИ не
  логується прозовим текстом (NFR), рендериться в UI лише як
  структуровані поля.

## Open questions

- **Редірект старого `/skills?skillId={id}` на `/skills/{id}`** —
  `[NEEDS CLARIFICATION]`. AC-2 видаляє гілку, що відкривала drawer за
  цим query-параметром, але не специфікує, чи має сама сторінка `/skills`
  розпізнати застарілий `?skillId=` і зробити client-side редірект на
  новий маршрут, чи просто ігнорувати параметр. Рекомендація: ігнорувати
  (немає зовнішніх посилань на цей URL поза самим застосунком, це
  pre-launch навчальний продукт, не production API з зовнішніми
  споживачами) — але залишено як рішення users'а, не вирішено тут
  односторонньо.
- **Restore — чи потрібен confirm-діалог перед перезаписом live `body`?**
  Мокап (за описом задачі) не специфікує. `SPEC-05`'s аналогічна дія
  ("Promote v{N}", T15) теж не мала confirm-кроку в жодному AC. За
  консистентністю рекомендація — без окремого confirm-діалогу (Restore
  веде себе як звичайне збереження Config, яке теж не має confirm) — але
  `[NEEDS CLARIFICATION]`, якщо власник продукту вважає відкат body
  ризикованішим за звичайне редагування.
- ~~**Injection guard для `skills`-блоку в `reviewer-core`
  (`wrapUntrusted()` відсутній, NFR MEDIUM finding)**~~ — **ЗАКРИТО
  2026-08-20**, окремим мінімальним фіксом поза обсягом SPEC-06 (як і було
  рекомендовано), бо торкалось production review-шляху для ВСІХ агентів,
  не лише нової Evals-вкладки. Деталі — NFR-секція вище.
- **`POST /skills/:id/evals/:caseId/run` без rate limit** (успадкований
  пробіл, той самий, що SPEC-05 вже залишила відкритою для агентського
  еквівалента) — рекомендація: закрити ОБИДВА одночасно окремим,
  мінімальним фіксом, не в обсязі цієї спеки.
- **Точна DDL/розміщення `SkillStats`-агрегатора** (окремий
  `server/src/modules/skills/stats-repository.ts`+`stats-helpers.ts`,
  дзеркалячи `agents/`, чи спільний модуль) — Development Plan рівень;
  ПОВЕДІНКА (AC-22–AC-27) зафіксована тут, файлова структура — ні.
- **Чи Restore (AC-30) також повинен інвалідувати/оновлювати клієнтський
  React Query кеш `["skill", id]` одразу** (щоб Config/Preview вкладки
  показали відновлений `body` без ручного refetch) — імовірно так (той
  самий патерн, що `useUpdateSkill`'s `onSuccess` уже робить,
  `hooks/skills.ts:49-53`, якщо Restore реалізовано як виклик того
  самого `useUpdateSkill`), але явно не специфіковано як окремий AC —
  Development Plan рівень деталізації.

## Task checklist

- [ ] T1 Маршрут-каркас: `client/src/app/skills/[id]/page.tsx` (тонкий,
      делегує) + `_components/SkillEditorView/SkillEditorView.tsx` з
      `constants.ts`'s `TABS` (config/context/preview/evals/stats/versions,
      іконки `Settings`/`FileText`/`Eye`/`FlaskConical`/`BarChart`/`History`
      — усі вже в `@devdigest/ui`'s `IconName`-реєстрі, нових не додавати),
      `?tab=`-стан і `VALID_TABS`-guard (той самий патерн, що
      `AgentEditorPage.tsx:16-21,33`), `ErrorState`-гілка на 404. У
      `SkillsListView.tsx` — картка веде на `/skills/{id}` замість
      `?skillId=`, видалити гілку `mode === "none" && selectedId`
      (рядки 37-39). У `SkillDrawer.tsx` — прибрати `mode: "edit"` з типу
      і з розгалужень; `submit()` для `"create"`/`"import"` робить
      `router.push` замість `onClose()` → AC-1, AC-2, AC-3, AC-4 →
      новий `SkillEditorView.test.tsx` (6 вкладок рендеряться, невалідний
      `?tab=` фолбечиться на `config`, 404 показує `ErrorState`),
      оновлені `SkillsListView.test.tsx` (клік картки навігує на
      `/skills/{id}`, не відкриває drawer) і `SkillDrawer.test.tsx`
      (успішний create/import навігує, не просто закриває)
- [ ] T2 Вкладка Config: новий
      `SkillEditorView/_components/ConfigTab/ConfigTab.tsx` — перенесені
      поля з `SkillDrawer`'s edit-режиму (мінус Context-секція), новий
      token-count напис (`approxTokens`, імпорт з
      `@/lib/hooks/project-context` через alias, не рахований `../`-ланцюжок
      — client/INSIGHTS.md 2026-08-02/2026-08-19 gotchas про неправильний
      підрахунок глибини) → AC-5, AC-6, AC-7 → новий `ConfigTab.test.tsx`
- [ ] T3 Вкладка Preview: новий `_components/PreviewTab/PreviewTab.tsx`
      — `<Markdown>{skill.body}</Markdown>`, read-only → AC-8, AC-9 →
      новий `PreviewTab.test.tsx` (рендерить markdown, немає жодного
      `<textarea>`/`contentEditable` в DOM)
- [ ] T4 Вкладка Context: новий `_components/ContextTab/ContextTab.tsx`
      (skill-версія) — той самий блок `ContextDocPicker`+«SERIALIZES AS»,
      перенесений з `SkillDrawer` unchanged → AC-10, AC-11 → новий
      `ContextTab.test.tsx` (attach/detach roundtrip через уже наявні
      `useSkillContextDocs`/`useSetSkillContextDocs`, той самий мок-патерн,
      що агентський `ContextTab.test.tsx`)
- [ ] T5 Сервер: генералізувати `EvalsService` — додати `ownerKind:
      'agent' | 'skill'` параметр у `list`/`create`/`update`/`delete`/
      `run`/`runSet`/`listSetRuns`; звузити перший параметр приватного
      `executeCase()` з `AgentRow` до `{ provider: Provider; model:
      string; systemPrompt: string }`; новий приватний
      `resolveRunConfig(workspaceId, ownerKind, ownerId)` — гілка
      `'agent'` як сьогодні (реальний `AgentsRepository.getById` +
      `linkedSkills`), гілка `'skill'` = синтетичний об'єкт (AC-14) з
      `SKILL_EVAL_SYSTEM_PROMPT` + `resolveFeatureModel(..., 'skill_eval')`
      + `skillBodies: [skill.body]` (без фільтра на `enabled`, AC-15) →
      AC-12, AC-14, AC-15, AC-16 → новий
      `server/test/evals-skill-owner.it.test.ts` (skill-owned одиничний і
      bulk прогін персистує `eval_runs` з коректним
      `system_prompt_snapshot`, вимкнений скіл усе одно прогоняється)
- [ ] T6 Контракти: новий `FeatureModelId` `'skill_eval'` у
      `server/src/vendor/shared/contracts/platform.ts` **і**
      `client/src/vendor/shared/contracts/platform.ts` (синхронно, root
      INSIGHTS.md 2026-07-31) — `FEATURE_MODELS`-запис `{label: "Skill
      Eval", description: "Runs a skill's isolated eval set to test it
      before enabling.", defaultProvider: 'openrouter', defaultModel:
      'deepseek/deepseek-v4-flash'}` (той самий дешевий tier, що
      `onboarding`/`review_intent`/`conventions` — це dev-loop
      перевірка, не production-рев'ю); константа
      `SKILL_EVAL_SYSTEM_PROMPT` (AC-14's точний рядок) у
      `server/src/modules/evals/` → AC-14 → `server/test/contracts.test.ts`
      (`FeatureModelId.parse('skill_eval')` проходить), розширений тест
      `feature-models`-модуля (`resolveFeatureModel(..., 'skill_eval')`
      повертає дефолт, коли Settings не перевизначені)
- [ ] T7 Сервер: нові роути в `server/src/modules/evals/routes.ts` (чи
      сусідній файл) — `GET/POST /skills/:id/evals`, `PUT/DELETE
      /skills/:id/evals/:caseId`, `POST /skills/:id/evals/:caseId/run`,
      `GET/POST /skills/:id/eval-runs` (bulk з тим самим `{max: 5,
      timeWindow: '1 minute'}` rate-limit'ом) — workspace-scope перевірка
      ДО виклику сервісу → AC-13, AC-18, AC-19 → те саме
      `evals-skill-owner.it.test.ts` (CRUD roundtrip, 429 на перевищення
      ліміту, 404 на чужий воркспейс ДО LLM-виклику)
- [ ] T8 Клієнт: генералізувати hooks у `client/src/lib/hooks/evals.ts` —
      кожен хук приймає `{ ownerKind: 'agent' | 'skill'; ownerId: string
      }` замість жорсткого `agentId`, базовий шлях перемикається на
      `/agents/:id/...` чи `/skills/:id/...`; промотувати `EvalsTab`
      (`client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/`)
      у параметризований спільний компонент (нове розташування —
      implementer's call, за прецедентом `eval-case-modal`, ймовірно
      `client/src/components/eval-owner-tab/` чи подібне) — обидва
      виклики (`AgentEditor`, новий `SkillEditorView`'s Evals tab)
      передають `ownerKind`/`ownerId` → AC-17, AC-21 → оновлений
      `EvalsTab.test.tsx` (агентський кейс і надалі проходить незмінно) +
      новий тест на skill-owner виклик (базовий шлях
      `/skills/{id}/eval-runs`, не `/agents/...`)
- [ ] T9 Верифікація (без нового коду): підтвердити, що `EvalsService.dashboard()`
      і `GET /eval-dashboard` (T14 SPEC-05) НЕ чіпають `owner_kind: 'skill'`
      рядки (вони вже жорстко фільтрують на `'agent'`,
      `service.ts:352-354` — жодної зміни не потрібно, лише regression-
      тест, що фіксує це явно) → AC-20 → розширений
      `server/test/evals.it.test.ts` (skill-owned кейс/сет-ран існує в
      БД, `GET /eval-dashboard` відповідь його не містить)
- [ ] T10 Сервер: новий `server/src/modules/skills/stats-repository.ts` +
      `stats-helpers.ts`'s `computeSkillStats()` (чиста агрегація, без
      DB) — джерела: `agent_skills` (used_by_agents), `agent_runs`
      (`skill_ids`/`cost_usd`/`findings_count`/`status`, 30-денне вікно,
      per-agent-that-links-this-skill), `reviews.run_id` → `findings`
      (`category`/`accepted_at`/`dismissed_at`) для accept_rate і
      cost-атрибуції; новий контракт `SkillStats` (обидві копії
      `vendor/shared/contracts/`); `SkillsService.getStats()` + новий
      роут `GET /skills/:id/stats` → AC-22–AC-27 → новий
      `server/test/skill-stats.test.ts` (юніт, чиста агрегація:
      pull_rate/accept_rate null на порожньому наборі, cost-атрибуція
      рівномірно ділить `costUsd` на `findingsCount`) + новий
      `server/test/skill-stats.it.test.ts` (інтеграційний, реальний
      Postgres join через `agent_skills`→`agent_runs`→`reviews`→`findings`)
- [ ] T11 Клієнт: новий `_components/StatsTab/StatsTab.tsx` (skill-версія)
      — `MetricCard`-плитки (Used by / Pull rate / Accept rate),
      `BarRow`-список «Agents using this skill», `Donut` «Findings by
      category» в `$` (той самий `Donut`-компонент, що агентський
      StatsTab, кольори з того самого масиву `["var(--crit)",
      "var(--warn)", "var(--accent)", "var(--ok)", "var(--text-muted)"]`)
      → AC-22–AC-27 → новий `StatsTab.test.tsx` (skill-версія; уникнути
      дублікат-тексту пастки з client/INSIGHTS.md 2026-08-02, якщо
      два числа фікстури випадково збігаються — різні значення для
      used_by_agents/pull_rate/accept_rate у фікстурі)
- [ ] T12 Сервер: `GET /skills/:id/versions` (новий сервісний метод
      `SkillsService.listVersions(workspaceId, id)` — workspace-check ДО
      виклику `repo.listVersions`, AC-32) + новий контракт `SkillVersion`
      (обидві копії) → AC-28, AC-32 → розширений
      `server/test/skills.it.test.ts` (список версій зростає при кожній
      зміні `body`, 404 на чужий воркспейс)
- [ ] T13 Клієнт: промотувати `diffPromptLines`/`PromptDiffLine` з
      `CompareRunsModal/helpers.ts` у новий
      `client/src/lib/text-diff.ts` (другий, не-eval споживач — окремий
      "promote on second user" момент від того, що вже стався для
      `RunGroup`-родини) — обидва місця (`CompareRunsModal`, новий
      `VersionsTab`) імпортують з нового спільного модуля → AC-29 →
      оновлений `CompareRunsModal.test.tsx` (імпорт з нового шляху,
      поведінка незмінна)
- [ ] T14 Клієнт: новий `_components/VersionsTab/VersionsTab.tsx` —
      список версій (найновіші перші), вибір двох → diff (T13's
      `diffPromptLines`), Restore-кнопка → `useUpdateSkill({id, patch:
      {body: version.body}})` (перевикористаний наявний хук, не новий
      мутаційний виклик) → AC-28, AC-29, AC-30, AC-31 → новий
      `VersionsTab.test.tsx` (diff рендериться для двох обраних версій,
      Restore викликає `PUT /skills/:id` з тілом обраної версії)
- [ ] T15 Інтеграція: підключити всі 6 tab-компонентів (T2-T4, T8's
      промотований Evals tab, T11, T14) у `SkillEditorView` (T1's
      каркас) → AC-1 → розширений `SkillEditorView.test.tsx` (перемикання
      між усіма 6 вкладками рендерить очікуваний компонент кожної)
- [ ] T16 i18n: нові ключі під `client/messages/en/skills.json` (Config/
      Preview/Context/Stats/Versions tab labels та copy — `eval`-неймспейс
      уже ownerKind-агностичний, перевикористовується без змін для Evals
      tab) → жоден новий AC (лише i18n-ключі, не нова поведінка) →
      покривається наявними тестами T2, T3, T4, T11, T14, T15 (кожен
      робить свій `getByText`/`getByRole` проти рендереного copy), без
      окремого тесту на сам файл перекладів — той самий підхід, що
      SPEC-05's T10/T11 (демо-дані/скрипт без власного AC)
