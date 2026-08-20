Кілька проблем із цим хендлером, від найважливішої до дрібнішої.

## 1. `getStatus` не існує на `OctokitGitHubClient` / `GitHubClient`

Це зламає збірку/рантайм прямо зараз. Подивіться на `server/src/adapters/github/octokit.ts` — клас реалізує `listPullRequests`, `getPullRequest`, `postReview`, `listReviewComments`, `createReviewComment`, `openPullRequest`, `commitFiles`, `findOpenPr`, `getIssue`, `currentLogin`. Методу `getStatus` там немає, і в інтерфейсі `GitHubClient` (`@devdigest/shared`) я його теж не знайшов. Найближчий еквівалент — `getPullRequest(repo, number)`, з якого можна дістати `status` (`open`/`merged`/`closed`, див. `mapStatus` в тому ж файлі).

## 2. Не той спосіб отримати GitHub-клієнт

`new OctokitGitHubClient(container.secrets)` — конструктор очікує `token: string`, а не `SecretsProvider`. Правильний спосіб дістати клієнта — через контейнер: `await container.github()`. Він сам читає `GITHUB_TOKEN` із `SecretsProvider`, кешує інстанс і кидає `ConfigError`, якщо токена нема. У решті `pulls/routes.ts` саме так і роблять (`gh = await container.github()`, рядки 43, 222, 320, 343 у поточному файлі) — і зверніть увагу, що там це обгорнуто в `try/catch`, бо токена може не бути офлайн/локально.

Створювати `new OctokitGitHubClient(...)` прямо в роуті — це ще й порушення шару: роут не повинен імпортувати конкретний адаптер (`adapters/github/octokit.js`) напряму. Уся точка збирання адаптерів — `Container` (`server/src/platform/container.ts`), сервіси/роути повинні залежати від інтерфейсу `GitHubClient`, отриманого з контейнера, а не від конкретного класу. Приберіть імпорт `OctokitGitHubClient` з `routes.ts` взагалі.

## 3. `getPullRequest` приймає `RepoRef` + номер PR, а не просто `id`

Навіть якщо замінити виклик на `getPullRequest`, сигнатура — `getPullRequest(repo: RepoRef, n: number)`, тобто потрібні `owner`/`name` репозиторію плюс номер PR. `req.params.id` — це, судячи з інших роутів файлу (`GET /pulls/:id`), ідентифікатор рядка в БД (`t.pullRequests.id`), а не номер PR на GitHub і не `RepoRef`. Треба спершу підняти PR (і його репозиторій) з БД за цим `id`, як це робить сусідній `GET /pulls/:id` роут вище у файлі, і вже з нього взяти `owner`/`name`/`number` для виклику GitHub.

## 4. Нема обробки помилок / офлайн-режиму

Усі інші виклики `container.github()` у цьому файлі обгорнуті в `try/catch`, з коментарем "local-first: sync from GitHub when a token is configured, but never fail the read". Тут прямий `await client.getStatus(...)` без catch — якщо токена нема (`ConfigError`) або GitHub недоступний, ендпоінт впаде з 500 замість кодного поводження (наприклад, віддати збережений у БД статус).

## 5. Немає схеми/валідації параметрів

Інші роути в файлі передають `{ schema: { params: IdParams } }` у другому аргументі `app.get`. Тут схеми нема — `req.params.id` не типізований і не валідується Zod-провайдером.

## Як я б переписав

```ts
app.get('/pulls/:id/status', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);

  const [pr] = await container.db
    .select()
    .from(t.pullRequests)
    .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)));
  if (!pr) throw new NotFoundError('PR not found');

  try {
    const gh = await container.github();
    const detail = await gh.getPullRequest(
      { owner: pr.repos.owner, name: pr.repos.name },
      pr.pull_requests.number,
    );
    return { status: detail.status };
  } catch (err) {
    app.log.warn({ err }, 'GitHub status fetch skipped; serving persisted status');
    return { status: pr.pull_requests.status };
  }
});
```

Головне: (1) дістаньте `GitHubClient` через `container.github()`, а не через `new OctokitGitHubClient(...)` в роуті; (2) `getStatus` не існує — використовуйте `getPullRequest` і мапте `status` з відповіді, або взагалі віддавайте статус, уже збережений у БД, якщо він вам достатній і не потрібен live-виклик до GitHub; (3) додайте `schema.params` і `try/catch` за прикладом сусідніх роутів у цьому ж файлі.
