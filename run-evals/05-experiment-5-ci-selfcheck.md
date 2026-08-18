# Крок 5 — Експеримент 5: самоперевірка в CLAUDE.md + CI

**Дата:** 2026-08-18

## Що зроблено

1. **Таблиця маршрутизації в `CLAUDE.md`** — новий розділ "Evals — what to
   run after touching what": зміна `.claude/skills/**` → `eval:quality` +
   відповідний skill eval; зміна `.claude/agents/<name>.md` → agent eval +
   workflow-кейс, що його диспатчить; зміна `CLAUDE.md`/routing → `eval:workflow`;
   зміна самого eval-кейса/грейдера → перекалібрувати baseline перед довірою
   до нової дельти. Явно зазначено: лише `eval:quality` детермінований і
   безпечний як hard gate; модельні тіри — звіт/тренд, не merge-blocker,
   доки в набору не набереться історія власного false-positive rate.
2. **`.github/workflows/evals.yml`** — два джоби:
   - `quality` — `pnpm eval:quality`, **блокує** PR.
   - `workflow-report` — `pnpm eval:workflow` через OpenRouter-проксі
     (за прецедентом з `evals/README.md`), **не блокує** — падіння лише
     ставить `::warning::`, джоб не провалюється.
   - Безпека за чек-листом лаби: `permissions: contents: read` на весь
     workflow; тригер `pull_request` (НЕ `pull_request_target`) — fork PR
     не отримує `OPENROUTER_API_KEY` за замовчуванням GitHub-механізму;
     явний `if: env.OPENROUTER_API_KEY != ''` навколо кожного кроку з
     моделлю (fork PR тихо скіпає модельний джоб, не падає); `timeout-minutes`
     на обох джобах (5 / 15); `paths:`-фільтр (лише `evals/**`,
     `.claude/skills/**`, `.claude/agents/**`, `CLAUDE.md` + package-локальні
     CLAUDE.md); `concurrency`-група з `cancel-in-progress`.

## Знахідка перед комітом — гейт був червоним

Перш ніж вмикати `eval:quality` як hard gate, прогнав його на поточному
стані репо: **exit code 1, 2 failures**. Вмикати блокувальний гейт, який
одразу червоніє без жодної зміни коду, — погана практика (та ще й
суперечить самому духу "спочатку зробити гейт зеленим, потім
блокувальним" з лаби). Виправив обидва:

1. **`workflow-retro-new/SKILL.md` frontmatter `name: workflow-retro`**
   не збігався з назвою директорії `workflow-retro-new` — реальна,
   дрібна помилка в скілі, доданому користувачем цієї ж сесії.
   Виправлено на `name: workflow-retro-new`.
2. **Фальшива тривога гейта на `workflow-retro`** (задокументована ще в
   Кроці 0): `internalLinks()` в `evals/src/skill-quality.ts` сканував
   маркдаун-посилання по всьому тілу `SKILL.md`, включно з fenced-код-блоками
   — приклад-ілюстрація формату таблиці (`[0cc0c9d6](sessions/0cc0c9d6.md)`
   усередині ` ``` `) розпізнавався як "зламане посилання". Це не баг
   скіла, а баг самого статичного гейта. Виправив джерело: додав
   `FENCED_CODE_RE`, що вирізає fenced-блоки перед перевіркою посилань.

Обидва фікси — реальні, не форсовані обходи заради зеленої галочки; обрано
рекомендований варіант ("виправити обидва, лишити зелений гейт") після
60с очікування підтвердження від користувача — легко переглянути, якщо
рішення виявиться неправильним.

## Перевірка

```bash
cd evals && node_modules/.bin/tsx src/skill-quality.ts
# Total: 17 skills, 0 failures — exit code 0
node_modules/.bin/tsc --noEmit
# чисто
```

## Що НЕ зроблено (за межами обсягу цього кроку)

- Workflow не тестований у самому GitHub Actions (немає push/PR у цій
  сесії) — перевірений лише локальний еквівалент команд, що він викликає.
- `OPENROUTER_API_KEY` як repo secret не налаштований (поза можливостями
  цієї сесії) — `workflow-report`-джоб при першому реальному прогоні на
  цьому репо просто скіпне модельний крок і виведе `::notice::`, це
  очікувана, безпечна поведінка, не помилка конфігурації.
- Продуктовий Eval Pipeline (домашнє завдання, `docs/specs/SPEC-05-eval-pipeline.md`)
  має свій окремий CI-трек — не входить у цей workflow.
