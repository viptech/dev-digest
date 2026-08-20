# Куди покласти Slack-нотифікацію по завершенню review run

Коротко: Slack — це ще один зовнішній сервіс, тож він живе за тим самим
принципом, що вже застосований до GitHub/LLM/Git у цьому репо — **інтерфейс
у `@devdigest/shared`, конкретна реалізація в `server/src/adapters/`, доступ
через `Container`, виклик з місця, де run реально завершується**
(`server/src/modules/reviews/run-executor.ts`), а не з роута і не напряму з
сервісу через `fetch`.

Дивився на існуючий патерн для `GitHubClient` (`server/src/adapters/github/octokit.ts`,
`server/src/vendor/shared/adapters.ts`, `server/src/platform/container.ts`) —
Slack повторює його один в один.

## Файли, які потрібно додати/змінити

### 1. `server/src/vendor/shared/adapters.ts` — новий порт

Додати інтерфейс поруч з `GitHubClient`/`AuthProvider`, і новий ключ секрету:

```ts
// ---------- Slack (pluggable notifier) ----------
export interface SlackNotifyPayload {
  text: string; // fallback plain-text
  blocks?: unknown[]; // optional Block Kit payload
}

export interface SlackNotifier {
  notify(payload: SlackNotifyPayload): Promise<void>;
}
```

```ts
export type SecretKey =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'GITHUB_TOKEN'
  | 'DATABASE_URL'
  | 'SLACK_WEBHOOK_URL'
  | (string & {});
```

Це той самий барель, з якого й `server/`, і `reviewer-core/` тягнуть типи —
навіть якщо Slack потрібен тільки серверу, тримати порт разом з іншими
адаптерними інтерфейсами узгоджено з тим, як тут уже організовано код
(усе, що "зовнішній виклик", описано тут одним інтерфейсом, а не розкидано).

### 2. `server/src/adapters/slack/webhook.ts` — реальна реалізація

```ts
import type { SlackNotifier, SlackNotifyPayload } from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';

const TIMEOUT = 10_000;

/** SlackNotifier over an Incoming Webhook URL. */
export class SlackWebhookNotifier implements SlackNotifier {
  constructor(private webhookUrl: string) {}

  async notify(payload: SlackNotifyPayload): Promise<void> {
    await withRetry(() =>
      withTimeout(
        fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).then((res) => {
          if (!res.ok) throw new Error(`Slack webhook ${res.status}`);
        }),
        TIMEOUT,
      ),
    );
  }
}
```

(`withRetry`/`withTimeout` — ті самі хелпери, якими вже обгорнутий Octokit-клієнт,
`server/src/platform/resilience.ts`.)

### 3. `server/src/adapters/mocks.ts` — мок для тестів

```ts
export class MockSlackNotifier implements SlackNotifier {
  public sent: SlackNotifyPayload[] = [];
  async notify(payload: SlackNotifyPayload): Promise<void> {
    this.sent.push(payload);
  }
}
```

### 4. `server/src/adapters/index.ts` — додати в барель

```ts
export { SlackWebhookNotifier } from './slack/webhook.js';
```

(`MockSlackNotifier` вже підхопиться через наявний `export * from './mocks.js'`.)

### 5. `server/src/platform/container.ts` — резолвити через секрет

Slack потребує секрету (webhook URL), тому це асинхронний геттер за тим самим
патерном, що й `github()`:

```ts
// в ContainerOverrides:
slack?: SlackNotifier;

// у класі:
private _slack?: SlackNotifier;

async slack(): Promise<SlackNotifier | undefined> {
  if (this.overrides.slack) return this.overrides.slack;
  if (this._slack) return this._slack;
  const url = await this.secrets.get('SLACK_WEBHOOK_URL');
  if (!url) return undefined; // не сконфігуровано — нотифікація вимкнена, це не помилка
  this._slack = new SlackWebhookNotifier(url);
  return this._slack;
}
```

На відміну від `github()`, який кидає `ConfigError`, якщо токена нема, тут
повертаємо `undefined` — нотифікація опційна фіча, а не обов'язкова
залежність review-run'а.

### 6. `server/src/modules/reviews/notify.ts` — новий файл, форматування повідомлення

Окремий helper-файл (за прикладом `helpers.ts` у цьому ж модулі), а не логіка
прямо в `run-executor.ts` — щоб форматування Slack-тексту не роздувало й так
великий `runOneAgent`:

```ts
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import type { PullRow } from './repository.js';
import type { RunOutcome } from './run-executor.js';

/**
 * Best-effort Slack notification after a run finishes (success or failure).
 * Never throws — a Slack outage must not fail/rollback the run itself.
 */
export async function notifyRunComplete(
  container: Container,
  pull: PullRow,
  agent: AgentRow,
  result:
    | { status: 'done'; outcome: RunOutcome }
    | { status: 'failed' | 'cancelled'; error: string },
): Promise<void> {
  const slack = await container.slack().catch(() => undefined);
  if (!slack) return;

  const text =
    result.status === 'done'
      ? `✅ *${agent.name}* finished reviewing PR #${pull.number} — ${result.outcome.findings.length} finding(s), verdict: ${result.outcome.review.verdict}`
      : `⚠️ *${agent.name}* run on PR #${pull.number} ${result.status}: ${result.error}`;

  try {
    await slack.notify({ text });
  } catch {
    // best-effort — swallow; a Slack failure must not affect the run's own status
  }
}
```

### 7. `server/src/modules/reviews/run-executor.ts` — виклик у точці завершення

`runOneAgent` — це фактичне місце, де review run завершується (успішно чи ні):
успішний шлях закінчується на `this.container.runBus.complete(runId)` (рядок
~290), помилковий — у `catch` блоці перед `throw err` (рядок ~315). Обидва —
підходяще місце для виклику `notifyRunComplete`, одразу після
`saveRunTrace`, за тим самим "best-effort, не валимо run" підходом, що вже
використаний для `buildCallersDigest`/`buildRepoMapDigest` (try/catch,
залогувати й продовжити):

```ts
// у success-гілці, одразу перед `return { review, findings: findingRows, ... }`:
await notifyRunComplete(this.container, pull, agent, { status: 'done', outcome: { review, findings: findingRows, grounding, raw: outcome.review } });

// у catch-гілці, перед `throw err`:
await notifyRunComplete(this.container, pull, agent, { status, error: msg });
```

## Чому саме так

- **Порт у `shared`, а не прямий `fetch` у сервісі** — той самий принцип, що
  вже застосований до GitHub/LLM/Git: сервіс/executor ніколи не знає про
  Slack HTTP API, тільки про інтерфейс `SlackNotifier`. Тести підмінюють його
  через `ContainerOverrides.slack` (`MockSlackNotifier`), як зараз підмінюють
  `github`/`git`/`llm`.
- **`Container` — єдина composition root** — секрет (`SLACK_WEBHOOK_URL`)
  резолвиться там-таки, де й інші секрети, через `SecretsProvider`
  (`server/src/adapters/secrets/local.ts` — єдина точка читання секретів,
  чіпати напряму `process.env` в адаптері не можна за правилами репо).
- **Виклик з `run-executor.ts`, не з `service.ts` чи роута** — саме
  `runOneAgent` знає фактичний момент завершення одного run (успіх/фейл/
  cancel) і має під рукою `agent`, `pull`, `outcome`/`error`. `service.ts`
  лишень запускає виконання (`executeRuns`) fire-and-forget і не бачить
  результату кожного окремого run напряму.
- **Best-effort, ніколи не кидає** — так само як `repoIntel`-збагачення в
  тому ж файлі: Slack-даунтайм не повинен провалити чи скасувати сам review
  run.
- **Опційність через `undefined`, а не `ConfigError`** — на відміну від
  GitHub/LLM, Slack — необов'язкова інтеграція; якщо вебхук не
  сконфігуровано, run просто не нотифікує, без падіння.

## Що варто уточнити перед реалізацією

- Нотифікувати на кожен run (по одному агенту) чи один зведений summary на
  весь `executeRuns` (всі агенти по одному PR)? Вище я хукнув на рівень
  окремого run — простіше, але при "run all agents" це кілька Slack-повідомлень
  підряд. Якщо потрібен один зведений message — краще зібрати результати в
  `executeRuns` після циклу `for (const { agent, runId } of jobs)` і викликати
  нотифікацію звідти одним повідомленням, а не з `runOneAgent`.
- Чи Slack-канал/webhook per-workspace, чи один глобальний? Якщо
  per-workspace — `SLACK_WEBHOOK_URL` як єдиний `SecretKey` не підійде,
  знадобиться зберігати webhook у БД (наприклад, у `workspaces`-таблиці) і
  `container.slack(workspaceId)` замість глобального геттера без параметра.
