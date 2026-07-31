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
