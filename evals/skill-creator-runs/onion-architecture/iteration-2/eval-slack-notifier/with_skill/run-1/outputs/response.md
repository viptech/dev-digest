# Куди йде Slack-інтеграція

Це нова зовнішня інтеграція (як GitHub/git/LLM), тож вона проходить той самий
п'ятикроковий шлях, що й будь-який адаптер у цьому бекенді — порт → адаптер →
мок → wiring у `Container` → виклик з сервіса через `container`, а не напряму.
Ось конкретний набір файлів для "post a Slack message when a review run
finishes".

## 1. Порт — `server/src/vendor/shared/adapters.ts`

Додай інтерфейс поруч із `GitHubClient`, `GitClient` і т.д. Назва — за
можливістю ("Notifier"), не за вендором ("SlackClient"), бо порт може
знадобитися для інших каналів сповіщень пізніше:

```ts
export interface RunFinishedNotification {
  workspaceId: string;
  prId: string;
  prTitle: string;
  agentName: string;
  verdict: string;
  findingsCount: number;
  runUrl: string;
}

export interface Notifier {
  notifyRunFinished(input: RunFinishedNotification): Promise<void>;
}
```

Якщо потрібен лише для `server/`, а не для `reviewer-core`/`e2e`, можна
покласти в module-local `modules/reviews/types.ts` замість shared — але
сповіщення про завершення рану, ймовірно, знадобляться й іншим модулям
пізніше, тож shared виглядає правильним вибором.

## 2. Адаптер — `server/src/adapters/notifier/slack.ts`

Єдиний файл, якому дозволено імпортувати Slack SDK (`@slack/web-api` або
просто `fetch` на webhook URL):

```ts
import type { Notifier, RunFinishedNotification } from '@devdigest/shared';

export class SlackNotifier implements Notifier {
  constructor(private webhookUrl: string) {}

  async notifyRunFinished(input: RunFinishedNotification): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: this.formatMessage(input) }),
    });
  }

  private formatMessage(input: RunFinishedNotification): string {
    // ...
  }
}
```

Каталог `adapters/notifier/` новий — за аналогією до `adapters/github/`,
`adapters/git/`, `adapters/llm/` (один каталог на "kind" інтеграції).

## 3. Мок — `server/src/adapters/mocks.ts`

Додай `MockNotifier implements Notifier` поруч із `MockLLMProvider`,
`MockGitClient` тощо — з масивом `calls`, щоб тести могли перевірити, що
сповіщення відправилось (або НЕ відправилось, коли ран упав), без реального
Slack API.

## 4. Wiring — `server/src/platform/container.ts`

Той самий shape, що `_git`/`_github`: приватне поле + лінивий геттер,
override у `ContainerOverrides`, секрет через `SecretsProvider` (як
`GITHUB_TOKEN`):

```ts
export interface ContainerOverrides {
  // ...
  notifier?: Notifier;
}

export class Container {
  // ...
  private _notifier?: Notifier;

  async notifier(): Promise<Notifier> {
    if (this.overrides.notifier) return this.overrides.notifier;
    if (this._notifier) return this._notifier;
    const webhookUrl = await this.secrets.get('SLACK_WEBHOOK_URL');
    if (!webhookUrl) throw new ConfigError('SLACK_WEBHOOK_URL is not configured');
    this._notifier = new SlackNotifier(webhookUrl);
    return this._notifier;
  }
}
```

(async-метод, а не lazy getter, бо `secrets.get` асинхронний — так само як
`container.github()` вище в тому ж файлі.) `SLACK_WEBHOOK_URL` живе в
`~/.devdigest/secrets.json` / `process.env`, читається лише через
`LocalSecretsProvider` (root `CLAUDE.md`, "Secrets") — жодного нового
чокпойнта для читання секрету створювати не треба.

## 5. Виклик — `server/src/modules/reviews/run-executor.ts`

Ось де саме "run finishes". `ReviewRunExecutor.runOneAgent` — це місце, де
ран вже завершено: після `this.repo.saveRunTrace(runId, trace)` і
`this.container.runBus.complete(runId)`, приблизно на рядку 289-290 у файлі,
що читав. Найбезпечніше — best-effort виклик, що ніколи не валить сам ран
(за тим самим патерном, що `buildCallersDigest`/`buildRepoMapDigest` вище в
цьому ж файлі ковтають помилки збагачення промпту):

```ts
runLog.info('Run complete; trace persisted');
await this.repo.saveRunTrace(runId, trace);
this.container.runBus.complete(runId);

try {
  const notifier = await this.container.notifier();
  await notifier.notifyRunFinished({
    workspaceId,
    prId: pull.id,
    prTitle: pull.title,
    agentName: agent.name,
    verdict: outcome.review.verdict,
    findingsCount: findingRows.length,
    runUrl: `.../pulls/${pull.id}?run=${runId}`,
  });
} catch (err) {
  runLog.info(`Slack notify failed — ${(err as Error).message}`);
}
```

Якщо треба сповіщати і про `failed`/`cancelled` рани — той самий виклик (з
іншим verdict/повідомленням) додається в `catch`-блоці того ж методу, поруч
із `saveRunTrace(...traceFromBuffer...)`.

`ReviewService` тут не чіпається: він лише запускає `executor.executeRuns(...)`
fire-and-forget і не знає деталей одного рана — логіка "ран завершився"
природньо належить `run-executor.ts`, який вже й так відповідає за
persistence + observability цього моменту.

## Чому не інакше

- **Не імпортувати `SlackNotifier` напряму в `run-executor.ts`** — тоді тести
  ранера б'ють у реальний Slack webhook і немає способу підмінити канал.
  Через `container.notifier()` тест підставляє `MockNotifier` через
  `ContainerOverrides`.
- **Не класти форматування Slack-повідомлення в `run-executor.ts`** — деталі
  Slack (attachments, blocks, форматування markdown) належать адаптеру;
  `run-executor.ts` збирає лише доменні дані (`RunFinishedNotification`), не
  знає нічого про Slack-специфічний JSON.
- **Не робити виклик, що падає рана** — `notifyRunFinished` обов'язково в
  `try/catch`, інакше збій Slack API перетворить успішний рев'ю-ран на
  `failed`, що і оманливо, і небажано.
