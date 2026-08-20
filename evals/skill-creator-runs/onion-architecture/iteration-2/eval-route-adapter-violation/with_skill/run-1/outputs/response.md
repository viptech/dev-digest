Так, є проблема — і вона якраз та, на яку варто звернути увагу до мерджу.

## Головна проблема: route напряму імпортує і конструює адаптер

```ts
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';

app.get('/pulls/:id/status', async (req, reply) => {
  const client = new OctokitGitHubClient(container.secrets);
  ...
```

`routes.ts` тут імпортує конкретний клас із `adapters/github/octokit.js` і сам
його інстанціює через `new`. За onion-правилом цього репозиторію (`server/src/platform/container.ts`
як composition root) — `routes.ts` має говорити лише з `service.ts` (або, як у
цьому модулі, напряму з портом через `container`), а конкретний адаптер
(`OctokitGitHubClient`) має право імпортувати **тільки** `container.ts`.

Чому це не дрібниця:
- у тестах роут тепер неможливо ізолювати без живого GitHub API — `container`
  у тестах підмінює адаптер через `ContainerOverrides`/`overrides.github`,
  але цей код той механізм повністю обходить, конструюючи клієнт напряму;
- якщо колись `OctokitGitHubClient` заміниться на інший клієнт (інший токен,
  інша бібліотека), доведеться правити кожен роут, що зробив so `new`, а не
  один composition root;
- `container.secrets` тут передається в конструктор напряму — а токен
  (`GITHUB_TOKEN`) і його resolve-логіка вже інкапсульовані в
  `container.github()` (`server/src/platform/container.ts:153-160`), включно
  з перевіркою, що токен взагалі налаштований (`ConfigError`, якщо ні).

## Що вже є в контейнері

Метод уже готовий:

```ts
// server/src/platform/container.ts:153
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;
  if (this._github) return this._github;
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  this._github = new OctokitGitHubClient(token);
  return this._github;
}
```

Він кешує клієнт, ресолвить токен через `secrets`, і саме тут (і тільки тут)
дозволено імпортувати `OctokitGitHubClient`.

## Фікс

У цьому модулі (`modules/pulls`) окремого `service.ts` немає — інші хендлери в
`routes.ts` (напр. `GET /pulls/:id`) вже орієнтуються на `container.github()`
напряму як на порт, без `new` і без імпорту адаптера. Тримайтесь того самого
паттерна:

```ts
app.get('/pulls/:id/status', async (req, reply) => {
  const client = await container.github();   // тип GitHubClient — порт, не клас
  const status = await client.getStatus(req.params.id);
  return reply.send({ status });
});
```

І приберіть імпорт `OctokitGitHubClient` з `routes.ts` — він там більше не
потрібен.

Дрібниця збоку: якщо `getStatus` — новий метод, перевірте, що він оголошений
у порту `GitHubClient` (у `@devdigest/shared`), а не додається лише в
`OctokitGitHubClient` — інакше типізація через `container.github()` його не
побачить, і мимоволі захочеться знов імпортувати конкретний клас.

## Підсумок

- Прибрати `import { OctokitGitHubClient } from '../../adapters/github/octokit.js'` з `routes.ts`.
- Прибрати `new OctokitGitHubClient(container.secrets)`.
- Замінити на `await container.github()`, за прикладом решти хендлерів у
  цьому ж файлі (`server/src/modules/pulls/routes.ts`, рядки з `container.github()`).
- Переконатись, що `getStatus` є частиною порту `GitHubClient`, а не тільки
  конкретної реалізації.
