# Сценарій демо-відео — L07 ДЗ

Показати: мультиагентний запуск на PR → групування знахідок → живі статуси →
автоматичний запуск рев'юера в GitHub Actions.

## Підготовка (не на записі)

```sh
./scripts/dev.sh          # Postgres + .env + deps + migrate + seed + API + web
```

Переконайтесь, що в студії вже є 2-3 продуктових review-агенти (security,
stack-specific, conventions-подібні — за словами лабораторної, вони мали
лишитись з попередніх уроків) і demo-PR з реальним diff.

## Частина A — Multi-Agent Review (~2 хв)

1. Відкрити PR-сторінку → вкладка **Multi-Agent Review**.
2. Порожній стан (перший візит) → **Start New Review**.
3. Configure run screen: позначити 3 агенти, показати оцінку часу/вартості
   (сума `avg_cost_usd`, max `avg_latency_ms`) → **Run multi-agent review (3)**.
4. Columns-режим: живі статуси колонок, поки агенти виконуються конкурентно —
   показати, що одна колонка може завершитись раніше за іншу.
5. Після завершення — розгорнути **Where agents disagree**: клацнути
   **Show only conflicts**, показати рядок, де один агент каже WARNING, а
   інший — "did not flag".
6. Перемкнутись у **Tabs**-режим, розгорнути одну знахідку з suggested fix,
   натиснути **Accept**.
7. **View trace** на одній колонці → показати сайдбар (Configuration/Stats/
   Prompt assembly/Copy raw output).

## Частина B — Export to CI (~2-3 хв)

1. Сторінка агента → вкладка **CI** → **Add to CI**.
2. Export Wizard: Target (GitHub Actions), Preview (показати
   `.devdigest/agents/<slug>.yaml` і `.github/workflows/devdigest-review.yml`,
   відредагувати щось у Preview — показати, що правка збережеться), Configure
   (тригери, Post results as, "Block merge" — disabled з поясненням),
   Install → **Install** (Open a PR).
3. Перейти на GitHub, показати відкритий PR з файлами.
4. **Заздалегідь** (до запису): змержити цей PR, додати `OPENROUTER_API_KEY`
   у Settings → Secrets цільового репо, відкрити тестовий PR — щоб на записі
   вже можна було показати готовий прогін.
5. Показати вкладку **Actions** цільового репо — зелений/червоний чек
   `devdigest-review` job, залежно від verdict.
6. Повернутись у студію → **CI Runs** (глобальна сторінка) → показати рядок
   із щойної CI-прогону: findings-лічильники, cost, duration, **Trace**
   (відкриває GitHub Actions job у новій вкладці).

## Нотатки

- Якщо `Fail CI on: CRITICAL` — покажіть, що required check стає
  червоним, і поясніть усно, що сам verdict блокує merge лише за
  налаштованим branch protection/ruleset (студія цього не імітує).
- Тримайте demo-PR маленьким (кілька файлів) — швидший LLM-виклик, коротше
  очікування на записі.
