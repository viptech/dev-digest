# Where the Slack integration goes

Short answer: **nowhere near `run-executor.ts` directly.** This is a brand-new
external integration, so it gets the full five-piece treatment — port,
adapter, mock, container wiring, consumer — not just a `fetch()` call dropped
into the executor. Skipping straight to "just call the Slack webhook from
`run-executor.ts`" is exactly the shortcut that works today and can't be
tested or swapped tomorrow.

## The shape (mirrors `GitHubClient` / `GitClient` already in the codebase)

```
routes.ts (unaffected)
run-executor.ts  --calls-->  container.notifier (Notifier port)
                                     ^
                                     |
                        adapters/notifier/slack.ts (SlackNotifier)
                                     ^
                                     |
                        adapters/mocks.ts (MockNotifier)
                                     ^
                                     |
                        platform/container.ts (wires which one)
```

## Files to add / touch

### 1. Port — `server/src/vendor/shared/adapters.ts`

Every other adapter interface the container wires (`GitHubClient`,
`GitClient`, `Embedder`, `AuthProvider`, `SecretsProvider`) lives here, and
`container.ts` already imports all its port types from `@devdigest/shared`.
Follow that convention rather than inventing a module-local `types.ts` — the
container needs to reference the type regardless, and every existing port
that the container wires lives in this one file.

Name it for the capability, not the vendor:

```ts
// server/src/vendor/shared/adapters.ts (append near the other port interfaces)

export interface ReviewRunFinishedNotification {
  workspaceId: string;
  prId: string;
  prTitle: string;
  prUrl: string;
  agent: string;
  verdict: 'approve' | 'request_changes' | 'comment' | string;
  score: number | null;
  findingsCount: number;
  blockers: number;
  durationMs: number;
}

export interface Notifier {
  notifyReviewRunFinished(event: ReviewRunFinishedNotification): Promise<void>;
}
```

Re-export it from `server/src/vendor/shared/index.ts` the same way the other
port types are re-exported (check that barrel — `adapters.ts` types get
re-exported there for `@devdigest/shared` consumers).

Also extend `SecretKey` in the same file so the Slack webhook URL is a typed
secret, not a magic string:

```ts
export type SecretKey =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'GITHUB_TOKEN'
  | 'DATABASE_URL'
  | 'SLACK_WEBHOOK_URL'   // new
  | (string & {});
```

### 2. Adapter — `server/src/adapters/notifier/slack.ts` (new folder)

The **only** file allowed to know Slack exists (webhook URL format, payload
shape, `fetch` call). No SDK needed for an incoming-webhook — plain `fetch`
is fine and keeps the dependency footprint at zero, matching how lean
`adapters/secrets/local.ts` is.

```ts
// server/src/adapters/notifier/slack.ts
import type { Notifier, ReviewRunFinishedNotification } from '@devdigest/shared';

export class SlackNotifier implements Notifier {
  constructor(private readonly webhookUrl: string) {}

  async notifyReviewRunFinished(event: ReviewRunFinishedNotification): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: this.format(event) }),
    });
    if (!res.ok) {
      // Never throw into the review pipeline over a notification failure —
      // log and swallow. (Mirrors the embedder/priceBook "best effort,
      // degrade gracefully" pattern already used for optional side channels.)
      throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
    }
  }

  private format(e: ReviewRunFinishedNotification): string {
    const verdictEmoji = e.blockers > 0 ? ':red_circle:' : ':white_check_mark:';
    return [
      `${verdictEmoji} *${e.agent}* finished reviewing <${e.prUrl}|${e.prTitle}>`,
      `verdict: ${e.verdict} · score: ${e.score ?? 'n/a'} · findings: ${e.findingsCount} (${e.blockers} blocker(s)) · ${Math.round(e.durationMs / 1000)}s`,
    ].join('\n');
  }
}
```

### 3. Mock — `server/src/adapters/mocks.ts`

Add `MockNotifier` alongside `MockLLMProvider` / the other mocks already in
this file, recording calls so tests can assert on them without hitting the
network:

```ts
// server/src/adapters/mocks.ts (append)
import type { Notifier, ReviewRunFinishedNotification } from '@devdigest/shared';

export class MockNotifier implements Notifier {
  public calls: ReviewRunFinishedNotification[] = [];

  async notifyReviewRunFinished(event: ReviewRunFinishedNotification): Promise<void> {
    this.calls.push(event);
  }
}
```

### 4. Wire it — `server/src/platform/container.ts`

Same lazy-getter shape as `_git` / `_github` / `codeIndex`:

```ts
// imports
import type { Notifier } from '@devdigest/shared';
import { SlackNotifier } from '../adapters/notifier/slack.js';

// ContainerOverrides
export interface ContainerOverrides {
  // ...existing fields
  notifier?: Notifier;
}

// Container class
private _notifier?: Notifier;

/**
 * Best-effort Slack notifications. Falls back to a no-op notifier when
 * SLACK_WEBHOOK_URL isn't configured — posting to Slack is optional, unlike
 * GITHUB_TOKEN/OPENAI_API_KEY which throw via ConfigError when missing.
 */
async notifier(): Promise<Notifier> {
  if (this.overrides.notifier) return this.overrides.notifier;
  if (this._notifier) return this._notifier;
  const webhookUrl = await this.secrets.get('SLACK_WEBHOOK_URL');
  this._notifier = webhookUrl ? new SlackNotifier(webhookUrl) : { notifyReviewRunFinished: async () => {} };
  return this._notifier;
}
```

(Made it async like `container.github()` / `container.llm()` because reading
the secret is async — same pattern as those two, not the sync getters like
`git`/`codeIndex` which don't need a secret lookup.)

### 5. Consume it — `server/src/modules/reviews/run-executor.ts`

This is the only file in the module that changes, and it changes by *calling
the port*, never by importing `SlackNotifier`. The question is which "run
finishes" you mean:

- **Per PR review batch** (all queued agents for one PR done) — fire once at
  the end of `executeRuns`, after the `for (const { agent, runId } of jobs)`
  loop (around run-executor.ts:135). This reads as "the review run for this
  PR is done" and avoids one Slack message per agent when several agents are
  queued on the same PR.
- **Per individual agent run** — fire inside `runOneAgent`, right after
  `this.container.runBus.complete(runId)` (run-executor.ts:290), using the
  data already sitting in `outcome`/`review`/`blockers` at that point.

Given the module is literally called `reviews` and a PR can have multiple
agents queued together, I'd default to the batch version unless you want a
Slack message per agent — worth confirming with whoever's consuming the
channel before picking. Sketch for the batch version:

```ts
// run-executor.ts, end of executeRuns(), after the for-loop
const notifier = await this.container.notifier();
for (const { agent, runId } of jobs) {
  // pull the persisted review row / blockers count you already have
  // per-agent (or re-fetch via this.repo) and call:
  await notifier
    .notifyReviewRunFinished({ workspaceId, prId: pull.id, prTitle: pull.title, prUrl: pull.url, agent: agent.name, verdict, score, findingsCount, blockers, durationMs })
    .catch((err) => logger?.warn({ err }, 'Slack notification failed'));
}
```

Wrap the call in `.catch()` — a Slack outage must never fail or delay the
review pipeline itself (same "best effort, degrade gracefully" contract the
container comment on `embedder()`/`priceBook` already documents).

## Summary of new/changed files

| File | Change |
|---|---|
| `server/src/vendor/shared/adapters.ts` | new `Notifier` port + `ReviewRunFinishedNotification` type + `SLACK_WEBHOOK_URL` added to `SecretKey` |
| `server/src/vendor/shared/index.ts` | re-export the new type/interface (match existing barrel pattern) |
| `server/src/adapters/notifier/slack.ts` | **new** — `SlackNotifier`, the only file that knows about Slack's webhook API |
| `server/src/adapters/mocks.ts` | **add** `MockNotifier` |
| `server/src/platform/container.ts` | **add** `notifier?: Notifier` override, `_notifier` field, `notifier()` async getter (composition root — the one legal place `SlackNotifier` gets imported/constructed) |
| `server/src/modules/reviews/run-executor.ts` | **add** one `await this.container.notifier().then(n => n.notifyReviewRunFinished(...))` call at the run-finished point you pick, wrapped in `.catch()` |

Nothing in `routes.ts` or `service.ts`'s public surface needs to change —
`run-executor.ts` already depends on `this.container`, so it just starts
reading one more thing off it, the same way it already reads `container.llm`,
`container.repoIntel`, and `container.runBus`.

One more thing worth deciding before writing code: should a Slack posting
failure ever be visible in the run's `RunLogger`/trace (so a broken webhook
shows up somewhere), or should it be pure fire-and-forget logged only to the
server's pino logger? The `.catch()` above assumes the latter (matches how
`buildCallersDigest`/`buildRepoMapDigest` degrade silently into the Live Log
as an `info` line rather than failing the run) — flag if you want it surfaced
differently.
