# Крок 0 — підключення пакета `evals/`

**Дата:** 2026-08-18
**Коміт:** `b25d66d` feat(evals): add evals/ package from upstream/l06-evals (L06 lab)

## Що зроблено

Лаба (`04-hands-on-lab.md`) вимагає `git fetch upstream && git merge upstream/l06-evals`.
`upstream` (`https://github.com/ai-agentic-engineering-neo/dev-digest`) у репо
не було — додано.

**Проблема:** `upstream/l06-evals` відрізаний від старого чекпоінту курсового
репо — до `.claude/agents/`, `.claude/plans/`, кількох скілів
(`workflow-retro`, `sdd-implement`, `react-ui-architecture`, `pr-self-review`)
і половини `server/` (модулі `skills`, `smart-diff`, контракти
project-context).

```
git diff --stat HEAD upstream/l06-evals
# 533 files changed, 6015 insertions(+), 82061 deletions(-)
```

Прямий `git merge` знищив би все це. Замість merge — cherry-pick лише нового
каталогу окремим комітом, точно за фолбеком, який сама лаба описує
("Якщо merge конфліктує з версією репозиторію, каталог переносять окремим
комітом"):

```bash
git checkout upstream/l06-evals -- evals
cd evals && pnpm install
```

## Перевірка

```bash
cd evals && node_modules/.bin/tsx src/skill-quality.ts
```

**Результат нульового рівня (`eval:quality`):** 16 скілів, 1 failure.

- Більшість — `WARN: no eval file` для старих скілів без покриття (очікувано,
  лаба явно допускає це як warning для старих скілів).
- Один справжній **FAIL**: `workflow-retro` — `SKILL.md` посилається на
  `sessions/0cc0c9d6.md`, якого немає. **З'ясовано, що це фальшива тривога
  гейта**, не реальний баг: `0cc0c9d6` — приклад-ілюстрація формату таблиці
  всередині `SKILL.md:176` (fenced-код-блок, зразок як виглядає рядок
  леджера), а не реальне посилання. Справжні дані — `docs/retros/ledger.md` +
  `docs/retros/sessions/fea391f8.md`, де жодного `0cc0c9d6` немає. Гейт не
  розрізняє "приклад у fenced-блоці" від "реального посилання" — обмеження
  самого статичного чекера, не привід правити скіл.

## Висновок

Пакет підключено чисто (51 файл, лише `evals/**`, нічого іншого в репо не
зачеплено). `pnpm install` — ok (є warning про ignored build scripts
esbuild, не блокує). Готово для Експерименту 1.
