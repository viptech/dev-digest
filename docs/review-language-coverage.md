# Мовний скоуп AI-рев'ю: React/.NET/PHP/Python

> Записано за підсумком аналітичної сесії (2026-08-16): чи буде якісним
> AI-рев'ю пул-реквестів для React, .NET (C#), PHP, Python, і чи потрібна
> мовно-специфічна адаптація під кожну з них. Кожне твердження нижче
> звірене з кодом (file:line), а не перенесене з чернетки без перевірки.
> Це аналіз, не implementation plan — дат/задач тут немає.

## Коротка теза

AI-рев'ю складається з двох шарів з різною мовною чутливістю:

1. **Ядро рев'ю-пайплайна** (`reviewer-core`) — мовно-агностичне.
   Працює однаково коректно для React/TS, .NET, PHP, Python-діфів, бо
   оперує текстом промпту й номерами рядків, а не AST.
2. **Шар збагачення контекстом** (`repo-intel`: repo-map, callers, blast
   radius, phantom-API gate, convention samples) — жорстко обмежений
   TS/JS/JSX-родиною файлів. Для інших мов він **мовчки повертає порожній
   результат** (graceful degrade, той самий шлях, яким деградує
   неіндексований репозиторій), а не падає і не блокує сам рев'ю.

Отже: React отримує повний пайплайн (LLM-рев'ю + весь контекст
repo-intel). .NET/PHP/Python отримують коректний LLM-рев'ю сирого діфу,
але без repo-map/callers/blast-radius/phantom-gate/convention-samples —
поки ці мови не додані в індексатор.

## Шар 1 — ядро рев'ю (`reviewer-core`), мовно-агностичне

- `reviewer-core/src/prompt.ts:46-50, 141-227` — `assemblePrompt` /
  `wrapUntrusted` / `INJECTION_GUARD` оперують текстом (diff, PR-опис,
  specs, intent), незалежно від мови коду в діфі.
- `reviewer-core/src/grounding.ts:41-84` — `groundFindings` /
  `rangeIntersects` перевіряють знахідки суто за перетином номерів рядків
  зі знайденими хунками `UnifiedDiff`. Жодного syntax/AST-аналізу.
- `server/src/modules/reviews/**` ніде не звіряється з
  `SUPPORTED_EXT`/`langForFile` (перевірено grep'ом по модулю) — сам
  запуск рев'ю не має мовного гейта.

Наслідок: injection guard і grounding gate однаково надійні для
React/.NET/PHP/Python-діфів. Модель так само здатна ревʼювати C#/PHP/
Python-код із сирого тексту діфу, як і TS/JS — це властивість LLM, не
щось, що вмикається конфігом.

## Шар 2 — repo-intel, жорстко обмежений TS/JS/JSX

Обмеження — явний, повторений на кількох рівнях фільтр, не побічний
ефект:

- `server/src/modules/repo-intel/constants.ts:14` —
  `SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']`.
  Єдиний supported-scope для walk і parse.
- `server/src/modules/repo-intel/pipeline/walk.ts:100-101` — фільтр за
  `SUPPORTED_EXT` застосовується вже на етапі обходу клону (`walkDir`):
  файл нецільової мови не потрапляє навіть у список кандидатів на
  парсинг — це раніше й жорсткіше, ніж «AST-парсер повернув порожньо».
- `server/src/adapters/astgrep/index.ts:57-76` (`langForFile`) — мапить
  лише ці ж розширення в `Lang.TypeScript` / `Lang.Tsx` /
  `Lang.JavaScript`; усе інше → `null`. `parseSymbols` (173-176),
  `parseReferences` (402-404), `parseInvocationHeads` (487-489),
  `parseImports` (558-560) — кожен одразу повертає `[]` для файла з
  `lang === null`.
- `server/src/adapters/codeindex/extract.ts:2` — regex-фолбек прямо
  задокументований як «Enhanced regex symbol/reference extractor for
  TS/JS» — той самий скоуп, не універсальний.
- `server/src/adapters/depgraph/index.ts` — обгортка над
  `dependency-cruiser` (пакет орієнтований на резолюцію
  JS/TS/CommonJS-імпортів; не резолвить C#/PHP/Python-імпорти).
  `buildEdges` (рядки 49-53) додатково сама фільтрує кінцеві вузли за
  `hasSupportedExt`, а вхідний список файлів уже профільтрований на
  етапі `walk.ts` — dependency-cruiser тут ніколи навіть не бачить файл
  нецільової мови.
- `server/src/modules/repo-intel/service.ts:534`
  (`getCallerSignatures`) і `service.ts:653-654`
  (`getUnresolvedReferences`) явно перевіряють
  `langForFile`/`SUPPORTED_EXT` на вході й пропускають файл без цього
  розширення.

### Наслідок для фасаду `repoIntel.*`

| Метод фасаду | `.ts`/`.tsx`/`.js`/`.jsx` (React) | `.cs`/`.php`/`.py` |
|---|---|---|
| `getRepoMap` | ✅ повний | ❌ порожньо |
| `getCallerSignatures` | ✅ повний | ❌ порожньо |
| `getBlastRadius` | ✅ повний | ❌ порожньо |
| `getUnresolvedReferences` (phantom-gate) | ✅ повний | ❌ порожньо |
| `getConventionSamples` | ✅ повний | ❌ порожньо |

Це той самий шлях `degraded: true` / `[]`, яким `repo-intel` уже
документує деградацію неіндексованого чи частково проіндексованого
репозиторію — не крах і не помилка, а тихе «немає додаткового
контексту».

## Що НЕ деградує

Сам LLM-рев'ю (verdict/findings) для .NET/PHP/Python не блокується і не
деградує сам по собі. Деградує лише **додатковий контекст**, який
repo-intel міг би додати до промпту (repo-map, callers, blast-radius
нотатка, phantom-gate); модель усе одно рев'ює сирий diff, і grounding
gate так само відкидає негрунтовані знахідки.

## Ідеї для мовної адаптації (не план, лише напрямки)

Якщо колись знадобиться паритет із React для інших мов — це окрема
інженерна робота на кожну мову, не перемикач конфігу:

- **Python** — `@ast-grep/napi@0.43.0` (версія в `server/package.json`)
  імовірно має python-граматику «з коробки», але вся node-kind-логіка в
  `astgrep/index.ts` (`function_declaration`/`class_declaration`/
  `method_definition` тощо) специфічна до JS/TS-форми AST — знадобилась
  би паралельна гілка під python node-kinds. `dependency-cruiser` не
  резолвить python-імпорти — потрібен окремий резолвер (наприклад, на
  основі `ast`-парсингу імпортів).
- **PHP** — спершу перевірити, чи `@ast-grep/napi@0.43.0` взагалі
  бандлить PHP-граматику (список мов у napi вужчий за ast-grep CLI);
  власні node-kind під `function_definition`/`method_declaration`;
  імпорт-граф — на основі composer autoload/namespace, а не
  dependency-cruiser.
- **.NET (C#)** — підтримка C# у ast-grep/tree-sitter менш зріла;
  імпорт-граф природніше брати з Roslyn/MSBuild project references, а
  не з ast-grep/dependency-cruiser — інший клас інструменту, не
  розширення поточного адаптера.
- **Route/endpoint-екстракція** (`getRepoFacts.routes`,
  `extractEndpoints` у `codeindex/extract.ts`) — окремі патерни під
  Laravel/Symfony (PHP), Flask/FastAPI/Django (Python), якщо теж
  хочеться крос-мовно.

## Пов'язане

- `reviewer-core/README.md` — пайплайн ядра рев'ю (assemble → wrap →
  LLM → ground).
- `server/src/modules/repo-intel/README.md` — пайплайн індексатора
  (walk → AST → edges → rank → repo-map) і деградація неіндексованого
  репо.
