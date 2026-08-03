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
