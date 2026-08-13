# INSIGHTS — client (`@devdigest/web`)

Знахідки по клієнту (Next.js/React). Append-only — див.
[`.claude/skills/engineering-insights`](../.claude/skills/engineering-insights/SKILL.md).

---

## 2026-07-28 · gotcha
**`toPrecision(N)` округлює "рівні" десяткові дроби не так, як очікує людина**
`0.0135` у binary float — насправді `0.013499999999999999847`, тож
`(0.0135).toPrecision(2)` дає `"0.013"`, а не інтуїтивно очікуване `"0.014"`.
Для округлення USD-сум/подібних "чистих" чисел до N значущих цифр надійніше
множити на степінь десяти, застосувати `Math.round`, і ділити назад — це працює
з тим, як насправді округлює `*`/`Math.round`, а не з десятковим представленням.
Доказ: client/src/components/run-cost-badge/helpers.ts:13-19

## 2026-07-28 · gotcha
**`screen.getByText(...)` нормалізує пробіли лише в DOM-тексті, НЕ в самому рядку-матчері**
`@testing-library/dom`'s `matches()` викликає `normalizer()` тільки для
`node.textContent`, після чого порівнює його з матчером через строгу рівність
без будь-якої нормалізації матчера. Якщо компонент рендерить вузький нерозривний
пробіл U+202F (напр. як розділювач тисяч), а очікуваний рядок у тесті набраний
зі звичайним пробілом — після нормалізації DOM-тексту (яка звертає U+202F у
звичайний пробіл) вони все одно НЕ співпадуть, бо матчер лишається ненормалізованим.
Фікс: застосувати те саме `.replace(/\s+/g, " ")` до очікуваного рядка перед
`getByText`.
Доказ: client/src/components/run-cost-badge/RunCostBadge.test.tsx (тест
"detailed/total shows...") та @testing-library/dom/dist/matches.js:31-40
(`matches()` нормалізує лише `textToMatch`, не `matcher`)

## 2026-07-31 · gotcha
**`Chip`'s `color` prop робить видиму зміну лише разом з `icon`**
`Chip` (client/src/vendor/ui/primitives/Chip.tsx:40) застосовує `color` тільки
до іконки (`I && <I style={{color}}>`), не до тексту/фону. Передати `color` без
`icon` — код компілюється, але колір ніде не проявляється. Якщо потрібен
кольоровий чіп (напр. по критичності), обов'язково передавай і `icon`.
Доказ: client/src/vendor/ui/primitives/Chip.tsx:40-41

## 2026-07-31 · decision
**Для severity-кольору/іконки використовуй `SEV` з `primitives/tokens.ts`, а не `SEV_COLOR` з `FindingCard/constants.ts`**
`FindingCard/constants.ts:4-9` дублює лише кольори severity локально для картки;
канонічне джерело — `SEV` у `client/src/vendor/ui/primitives/tokens.ts:6-14`,
яке експортується з `@devdigest/ui` і містить і колір (`c`), і іконку (`icon`)
на рівень (WCAG-нота в Badge.tsx: "never color alone"). Нові UI-елементи, що
показують severity (чіпи, бейджі), мають брати дані звідти, а не заводити
власну мапу кольорів.
Доказ: client/src/vendor/ui/primitives/tokens.ts:6-14

## 2026-07-31 · gotcha
**`Severity` з `@devdigest/ui` ширший (4 значення) за `Severity` з wire-контракту (3 значення) — типізація `Severity[]` ламає індексацію у вузькі об'єкти**
`client/src/vendor/ui/primitives/tokens.ts:3` визначає
`"CRITICAL" | "WARNING" | "SUGGESTION" | "INFO"`, тоді як
`client/src/vendor/shared/contracts/findings.ts:11`
(`z.enum(['CRITICAL','WARNING','SUGGESTION'])`) — лише 3 значення. Якщо спільну
константу порядку відображення типізувати як `Severity[]` з `@devdigest/ui`
(широкий тип), а потім індексувати нею об'єкт, похідний від контракту (напр.
`FindingsSummary.counts`, який має рівно 3 явні ключі без index signature) —
TypeScript падає з TS7053 ("Property 'INFO' does not exist"), навіть якщо
рантайм-значення завжди коректні. Фікс: типізувати такі константи як
літеральний tuple (`as const satisfies readonly Severity[]`), а не як широкий
`Severity[]` — це звужує тип до фактичних 3 літералів і лишається
індекс-безпечним для вузьких контрактних форм.
Доказ: client/src/components/findings-tooltip/FindingsTooltip.tsx (константа
`SEVERITY_DISPLAY_ORDER`) та client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx
(`pr.findings_summary?.counts[sev]`)

## 2026-07-31 · gotcha
**У тестах з кількома однаковими fixture-об'єктами додавання нового дефолтного поля може створити дублікат тексту, який ламає `getByText`**
`FindingsTooltip.test.tsx`'s multi-finding hover-тест рендерить два `finding()`
з різними override для `title`/`file`/`start_line`/`end_line`, але без
override для нового поля `rationale` — обидва тоді успадковують однаковий
дефолт і рендерять ідентичний текст. Будь-яка нова асерція `getByText(...)` на
це поле падає з "multiple elements found", поки для кожного елемента
fixture-виклику не задати унікальне значення (або не перейти на
`getAllByText`).
Доказ: client/src/components/findings-tooltip/FindingsTooltip.test.tsx
(тест "shows each finding's title and file:line on hover..." — другий
`finding({ id: "f2", ... })` виклик тепер явно передає власний `rationale`)

## 2026-08-02 · gotcha
**План/бриф з готовим кодом рахує глибину `../` відносних імпортів для нової
папки на око — і помиляється на один рівень**
Для `EvalsTab/EvalsTab.tsx` (сьомий рівень вкладеності від `src`, як і
`SkillsTab/SkillsTab.tsx`) бриф пропонував `"../../../../../../lib/hooks/evals"`
(6 рівнів) — правильно 7, що видно порівнянням з реальним
`SkillsTab.tsx`. Для вкладеної `EvalsTab/_components/EvalCaseModal/
EvalCaseModal.tsx` (9 рівнів) бриф давав 8. TypeScript це не ловить
(модуль просто не резолвиться до `noUnusedLocals`-подібної перевірки — тут
взагалі падає з чіткою помилкою резолву), але `vi.mock(...)` з неправильним
шляхом тихо НЕ мокає хук (модуль з іншим resolved-шляхом не збігається), і
тест падає пізніше на мережевому виклику, а не на помилці мокання. Рахуй
глибину `node -e "path.relative(...)"` або порівнянням з існуючим файлом
на тому самому рівні вкладеності, а не копіюванням з брифу.
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx:6
(7 рівнів `../`, було виправлено з 6 як у брифі задачі Task 5 Evals Tab)

## 2026-08-02 · gotcha
**Готовий код тесту з брифу (Task 4, Stats Tab) сам містить дублікат тексту, що ламає `getByText`**
`task-4-brief.md`'s `StatsTab.test.tsx` задає одночасно `avg_cost_usd: 0.04`
(рендериться в MetricCard як "$0.04") і `run_history[0].cost_usd: 0.04`
(та сама таблична клітинка рендерить теж "$0.04") — `getByText("$0.04")`
падає з "Found multiple elements", хоча тест у брифі позначений як "Expected:
PASS". Не лише написаний вручну fixture-код (див. запис від 2026-07-31 про
`FindingsTooltip`) — готовий код у бриф-документі теж треба прогнати, а не
скопіювати наосліп. Фікс: зробити `cost_usd` у `run_history` іншим числом,
ніж `avg_cost_usd` (тут — 0.05).
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/StatsTab.test.tsx
(`run_history[0].cost_usd: 0.05`, коментар пояснює причину)

## 2026-08-02 · gotcha
**Глибина `../` імпорту з `_components/StatsTab` різна для `lib/hooks/*` (7 рівнів) і для сусіднього `app/repos/...` (6 рівнів) — та сама папка, різна кількість `../`**
Продовжує запис від 2026-08-02 про EvalsTab: рахувати "на око" по аналогії з
уже наявним імпортом того ж файлу небезпечно, якщо цілі лежать у різних
піддеревах. `StatsTab.tsx`'s `useAgentStats` імпорт іде
`"../../../../../../../lib/hooks/agents"` (7 `../`, бо ціль — `src/lib/...`),
але імпорт `RunTraceDrawer` з `src/app/repos/[repoId]/pulls/[number]/
_components/RunTraceDrawer` — лише 6 `../`, бо ціль сама лежить під `app/`
(на 1 рівень мілкіше за `lib/`, з яким порівнювали). Копіювання кількості
`../` з сусіднього імпорту в тому ж файлі — не надійний евристик; рахуй
`node -e "console.log(path.relative(fromDir, toDir))"` окремо для кожної
цілі.
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/StatsTab.tsx:6-7
(`../../../../../../../lib/hooks/agents` проти `../../../../../../repos/[repoId]/pulls/[number]/_components/RunTraceDrawer`)

## 2026-08-04 · gotcha
**`diff-viewer` не мав ЖОДНОГО механізму scroll-to-line/highlight до Smart Diff — не було що "перевикористати", довелось додавати з нуля в `FileCard`/`CodeLine`**
Плани, що посилаються на "reuse the existing scroll/highlight primitives" у
`@/components/diff-viewer`, мали на увазі майбутню фічу, не факт: до Smart
Diff `CodeLine`/`FileCard` не мали жодного `ref`/`scrollIntoView`/`highlight`
пропу — `grep -n "scrollIntoView" client/src/components/diff-viewer` не
знаходив нічого. Довелось додати мінімальний `highlight?: boolean` пропс у
`CodeLine` (з `useRef` + `useEffect(() => ref.current?.scrollIntoView(...))`)
і `scrollToLine?: number | null` у `FileCard` (форсує `open=true` і рахує
`highlight` для рядка з відповідним `ln.newNo`), а не переписувати diff-рендер
з нуля. Також `FileCard` не експортувався з публічного `diff-viewer/index.ts`
(лише `DiffViewer` + `DiffCommentApi`) — довелось розширити експорт, коли
з'явився другий викликач (`SmartDiffViewer`, що рендерить `FileCard` напряму
для групування по ролях, а не через `DiffViewer`).
Доказ: client/src/components/diff-viewer/CodeLine/CodeLine.tsx:17,29-35;
client/src/components/diff-viewer/FileCard/FileCard.tsx:36,51-53;
client/src/components/diff-viewer/index.ts:2 (новий `export { FileCard }`)

## 2026-08-06 · gotcha
**jsdom у цьому проєкті не реалізує `scrollIntoView` — будь-який ref-based
scroll-effect кине `TypeError`, поки компонент не протестований end-to-end**
`CodeLine`/`ReviewRunAccordion` роками викликали `ref.current?.scrollIntoView(...)`
без жодного полiфілу, і це не спливало, бо жоден існуючий тест насправді не
доводив рендер до точки, де `highlight`/`targetRunId` стає truthy для
змонтованого елемента (напр. `SmartDiffViewer.test.tsx` клікав бейдж, але
`prFile()` мав `patch: null` → рядок з потрібним `ln.newNo` просто не
рендерився). Перший тест, що дійсно домагається кліку/фокусу на змонтованому
вузлі (нова картка `FindingCard` з `forceFocus`), одразу впав з
`cardRef.current?.scrollIntoView is not a function`. Фікс — той самий
патерн, що вже є для `ResizeObserver`: global-стаб у test setup, а не мок у
кожному тестовому файлі окремо.
Доказ: client/src/test/setup.ts (доданий стаб `Element.prototype.scrollIntoView`)

## 2026-08-06 · decision
**Прив'язка Smart Diff "N findings" бейджа до Findings tab, а не до
скролу в diff, вимагала `id` у `SmartDiffFinding` — самого `line`+`severity`
не досить**
Щоб клік по бейджу розгортав КОНКРЕТНУ картку в Findings tab (а не просто
гортав diff), потрібно було адресувати finding за його реальним id, не лише
за номером рядка (кілька findings можуть теоретично лежати на одному рядку).
Контракт `SmartDiffFinding` довелось розширити полем `id` синхронно в
server- і client-копіях — легко забути оновити одну з двох при такій зміні
(вендор-дублювання схем, не спільний пакет).
Доказ: server/src/vendor/shared/contracts/brief.ts (`SmartDiffFinding`),
client/src/vendor/shared/contracts/brief.ts (та ж схема)

## 2026-08-13 · gotcha
**Агрегатний бейдж `ContextTab.tsx` і власний бейдж `ContextDocPicker` навмисно
показують ІДЕНТИЧНИЙ текст, коли `fromSkills === 0` — `getByText` тоді падає
з "multiple elements found"**
`aggregateBadge` ("{count} attached") і `ContextDocPicker`'s `attachedBadge`
("{n} attached") — той самий рядок-формат. Коли в агента нема enabled linked
skills (або вони не додають нових документів), `total === own`, тож на сторінці
рендериться два однакових текстових вузли ("N attached") одночасно. Це не баг
верстки, а прямий наслідок AC-24/Edge-case дизайну (без skills — тільки
власний рахунок, число просто дублюється в двох бейджах). У тестах, де
`fromSkills === 0`, треба `screen.getAllByText(...)` з перевіркою довжини
(2), а не `getByText` — інакше тест ламається саме тоді, коли фіча працює
правильно.
Доказ: client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx
(тести "renders the agent's attached document", "excludes a disabled linked
skill's docs...", "renders no breakdown line...")

## 2026-08-13 · fix
**`<Markdown>` рендерив h1-h6/ul/ol/li/blockquote/hr/pre/table як звичайний
текст — не бракувало react-markdown, бракувало `components`-оверрайдів**
Tailwind preflight (`@import "tailwindcss"` глобально) зануляє дефолтний
font-size/weight/margin для ЦИХ тегів; `Markdown` мав кастомні стилі лише
для `p`/`strong`/`code`/`a`, тож будь-який заголовок/список/цитата/код-блок
у прев'ю `.md`-документа (Project Context page, SPEC-01/SPEC-02) виглядав
візуально ідентично суцільному абзацу — доки хтось не відкрив реальний
багатосекційний документ. Додано явні оверрайди для решти тегів. Пастка №1:
перша спроба рендерити заголовки через `<div>` (не справжній `<hN>`) зламала
`ProjectContextPage.test.tsx`'s `getByRole("heading", ...)` — семантичний
тег обов'язковий, не лише візуальний розмір. Пастка №2: react-markdown v9
більше НЕ передає `inline`-прапорець у `code`-рендерер (був у v7/v8) —
inline vs fenced-блок тепер розрізняється лише за `className` (fenced-код
отримує `language-xxx` від remark, inline — ніколи).
Доказ: client/src/vendor/ui/primitives/Markdown.tsx (компонент), 
client/src/vendor/ui/styles.css:1 (`@import "tailwindcss"`)

## 2026-08-13 · decision
**Замінює попередній запис від 2026-08-13 про `<Markdown>` — ручні
per-element `components`-оверрайди прибрано на користь
`@tailwindcss/typography`'s `.prose`**
Той самий симптом (h1-h6/списки/цитати/hr/pre без типографіки), той самий
корінь (Tailwind preflight), але інше рішення: замість вручну стилізованого
`components`-об'єкта на кожен HTML-тег (крихко — новий remark-gfm конструкт,
напр. task-list чи footnote, знову виглядав би як голий текст, доки хтось
не додасть ще один оверрайд), підключено `@tailwindcss/typography` через
`@plugin "@tailwindcss/typography";` (Tailwind v4, CSS-first конфіг — немає
`tailwind.config.ts` в цьому проєкті) і клас `.prose` замінив увесь
`components`-об'єкт у `Markdown.tsx`. Ключове: **не** знадобився окремий
`.prose-invert`/`dark:`-варіант — застосунок вже тримає тему виключно через
`[data-theme]``-перемикні CSS custom properties (`--text-primary` тощо), тож
`.dd-md`'s `--tw-prose-*` мапляться на ці ж токени напряму (`--tw-prose-body:
var(--text-primary)` і т.д.) — та сама мапа коректна в обох темах без
дублювання. Побічний ефект типографіки, який довелось придушити: `.prose`
за замовчуванням обгортає inline `code` в лапки-бектіки (`::before`/`::after`
з `content: "`"`) — прибрано (`content: none`) і повернуто попередній
"пігулка"-вигляд лише для inline (`:not(pre code)`), щоб не міняти вже
усталений візуальний конвеншн.
Доказ: client/src/vendor/ui/styles.css (`@plugin "@tailwindcss/typography";`
і `.dd-md` блок з `--tw-prose-*`), client/src/vendor/ui/primitives/Markdown.tsx
(спрощено до `className="dd-md prose max-w-none"`, без `components` пропу)
