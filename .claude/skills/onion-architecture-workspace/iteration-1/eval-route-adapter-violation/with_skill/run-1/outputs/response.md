Так, є проблема з шаруватістю — і це саме той red flag №1, який описаний у скіллі `onion-architecture`: **route напряму імпортує та інстанціює конкретний адаптер**.

```ts
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';

app.get('/pulls/:id/status', async (req, reply) => {
  const client = new OctokitGitHubClient(container.secrets);   // ← ось тут
  const status = await client.getStatus(req.params.id);
  return reply.send({ status });
});
```

Чому це погано, конкретно тут:

1. **`routes.ts` має залежати тільки від `service.ts`, ніколи від `adapters/**`.** У цьому файлі (`server/src/modules/pulls/routes.ts`) усі інші хендлери йдуть через `container.github()` (async getter, `server/src/platform/container.ts:153-160`) — жоден з них не імпортує `OctokitGitHubClient` напряму. Твій новий хендлер порушує цю конвенцію, яку решта файлу дотримується послідовно.
2. **Ти обходиш composition root.** `container.ts` — єдине місце, де дозволено `new OctokitGitHubClient(...)`. Створюючи інстанс прямо в роуті, ти дублюєш цю логіку (і втрачаєш кешування — `container.github()` кешує клієнт у `_github`, а `container.invalidateSecretCaches()` це кешування скидає при зміні токена; твій виклик кожен раз створює новий клієнт і ніколи не інвалідується разом з рештою).
3. **Це неможливо мокнути в тестах.** `ContainerOverrides.github` (`container.ts:43`) — це саме той механізм, яким тести підміняють GitHub-клієнт на мок. Роут, що сам робить `new OctokitGitHubClient(...)`, ігнорує override і завжди піде в реальну мережу.
4. **`GITHUB_TOKEN` не обробляється.** `container.github()` кидає `ConfigError`, якщо токен не налаштований (`container.ts:156-157`), і решта роутів у цьому файлі це ловлять (`try { gh = await container.github() } catch ...`) та деградують gracefully. Твій код передає `container.secrets` напряму в конструктор `OctokitGitHubClient` — але подивись його сигнатуру: конструктор очікує токен-стрічку (`new OctokitGitHubClient(token)` в `container.ts:158`), а не `SecretsProvider`. Тобто це навіть не скомпілюється / не спрацює як задумано.

Як це має виглядати за конвенцією модуля (`routes.ts` → `service.ts` → адаптер через `container`):

```ts
// service.ts
export class PullsService {
  constructor(private container: Container) {}

  async getPrStatus(prId: string) {
    const gh = await this.container.github();   // container-resolved GitHubClient
    return gh.getStatus(prId);                  // якщо такого метода нема в GitHubClient — додати в порт
  }
}
```

```ts
// routes.ts
app.get('/pulls/:id/status', { schema: { params: IdParams } }, async (req, reply) => {
  const status = await pullsService.getPrStatus(req.params.id);
  return reply.send({ status });
});
```

Пара додаткових зауважень щодо самого модуля `pulls`:

- Якщо `getStatus` — це новий метод, якого зараз немає в інтерфейсі `GitHubClient` (`@devdigest/shared`), додай його в порт, а не тільки в `OctokitGitHubClient` — інакше сигнатура методу існуватиме лише в конкретному класі, і мок (`server/src/adapters/mocks.ts`) з ним розійдеться.
- Зверни увагу, що в цьому ж файлі вже є власний хелпер `deriveReviewStatus` (`server/src/modules/pulls/status.ts`) для похідного статусу PR (open/merged/closed + review freshness). Перш ніж додавати `/pulls/:id/status` як прямий проксі до GitHub API, варто перевірити — може, тобі насправді потрібен саме цей локальний статус, а не ще один похід у GitHub.
- У модулі поки немає окремого `service.ts` (весь код — у `routes.ts`, роботу з БД роути роблять напряму через `container.db`). Якщо додаєш перший метод, що йде в зовнішній API, це нормальний привід виділити `service.ts` за конвенцією `server/CLAUDE.md` ("Module shape: routes.ts + service.ts + repository.ts"), а не продовжувати розростати `routes.ts`.

Підсумок: перенеси виклик у `service.ts`, отримуй `GitHubClient` через `container.github()`, і роут залиш чистим HTTP-перекладачем (parse params → call service → serialize response).
