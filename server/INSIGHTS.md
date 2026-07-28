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
