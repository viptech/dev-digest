# INSIGHTS — reviewer-core

Знахідки, що не належать одному модулю продукту, але стосуються цього пакета
конкретно. Append-only — див.
[`.claude/skills/engineering-insights`](../.claude/skills/engineering-insights/SKILL.md).

---

## 2026-08-02 · decision
**Тіла скілів у промпті НЕ обгортаються `wrapUntrusted()` — свідомо, але клієнтський copy довго стверджував протилежне**
`assemblePrompt` рендерить `## Skills / rules\n${skillsBlock}` прямим текстом
(без delimiter-блоку `<untrusted>`), бо `PromptParts.skills` документований як
"trusted-ish". Реальна довірча межа для імпортованих скілів — лише
`enabled: false` за замовчуванням при імпорті (сервер,
`server/src/modules/skills/service.ts`), не delimiter-wrapping. Клієнтський
i18n (`client/messages/en/skills.json`) до 2026-08-02 обіцяв "delimiter-wrapped
as untrusted data", що не відповідало пайплайну — виправлено copy, а не
пайплайн (обгортання скілів `wrapUntrusted()` — окрема задача з розширенням
на CI-runner, тут свідомо не робилась).
Доказ: reviewer-core/src/prompt.ts:42-43,88-89,109

## 2026-08-03 · decision
**`PromptSectionMeta` (безпечні метадані секцій промпту для логування)
свідомо НЕ додано в persisted-контракт `PromptAssembly`**
`assemblePrompt` тепер повертає третє поле `sections:
PromptSectionMeta[]` (назва/джерело/довжина в символах/приблизні токени,
БЕЗ самого тексту) поряд з `messages`/`assembly`. Воно навмисно не
потрапило в `PromptAssembly` (`server/src/vendor/shared/contracts/trace.ts`)
і не персистується в `run_traces` — бо `PromptAssembly` дублюється
вручну між server- і client-контрактами (задокументований ризик
розсинхрону, `INSIGHTS.md` кореня 2026-07-31), і додавання туди чисто
логувального поля змусило б синхронізувати ще один клієнтський контракт
заради даних, які потрібні лише одному рядку структурованого логу.
`sections` живе тільки в `AssembledPrompt`/`ReviewOutcome` (ефемерно,
рахується наново щоразу) — сервер читає `outcome.sections` і одразу логує
через `RunLogger`, ніде не зберігаючи.
Доказ: reviewer-core/src/prompt.ts:96-101 (`AssembledPrompt.sections`),
reviewer-core/src/review/run.ts:101-105 (`ReviewOutcome.sections`),
server/src/modules/reviews/run-executor.ts:270-287 (єдиний споживач,
логує й не персистує)
