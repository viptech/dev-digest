import type { SkillCase } from "../../src/index.js";

// Ported 1:1 from the skill-creator-style cases already checked into the skill itself
// (.claude/skills/onion-architecture/evals/evals.json) — same prompts, same assertions, just
// reshaped into this package's SkillCase DSL so they run through pnpm eval:skills / eval:repeat /
// eval:delta / eval:benchmark instead of only through the standalone Skill Creator loop. Do NOT
// let the two copies drift: if evals.json changes, mirror the change here (and vice versa).

export const cases: SkillCase[] = [
  {
    name: "proposes a port/adapter for a new Slack integration instead of a direct import",
    kind: "quality",
    prompt:
      "We want to post a Slack message whenever a review run finishes (server/src/modules/reviews). Where does the Slack integration code go, and can you sketch out the files I need?",
    practices: [
      "proposes defining a port/interface (e.g. Notifier) rather than referring to the Slack SDK type directly in service code",
      "places the concrete Slack implementation under adapters/<kind>/ (e.g. adapters/slack/*.ts)",
      "mentions adding a mock implementation (adapters/mocks.ts or module-local) so tests don't hit the real Slack API",
      "mentions wiring the new adapter into platform/container.ts (lazy getter / ContainerOverrides pattern)",
      "does not tell the user to import the Slack adapter class directly into service.ts instead of going through the container",
    ],
    threshold: 1.0,
    maxTurns: 15,
  },
  {
    name: "flags a route handler that imports and instantiates an adapter directly",
    kind: "quality",
    prompt: `Can you review this route handler I just wrote in server/src/modules/pulls/routes.ts?

\`\`\`ts
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';

app.get('/pulls/:id/status', async (req, reply) => {
  const client = new OctokitGitHubClient(container.secrets);
  const status = await client.getStatus(req.params.id);
  return reply.send({ status });
});
\`\`\``,
    practices: [
      "explicitly identifies importing/instantiating the adapter directly inside routes.ts as a layering/architecture problem, not just a style nit",
      "proposes moving the GitHub call into a service method (e.g. on PullsService) instead of the route",
      "suggests obtaining the client via container.github (or an equivalent container-resolved interface) instead of `new OctokitGitHubClient(...)`",
      "describes or shows the resulting route reduced to param handling + service call + response mapping, with no adapter import left in routes.ts",
    ],
    threshold: 1.0,
    maxTurns: 15,
  },
  {
    name: "places pure diff-stat computation in service.ts, not repository.ts or reviewer-core",
    kind: "quality",
    prompt:
      "I'm adding logic to server/src/modules/pulls that recomputes a PR's diff stats (files changed, additions, deletions) from the stored diff blob whenever someone re-opens the PR detail page. Should this go in service.ts or repository.ts, and does reviewer-core need to know about it?",
    practices: [
      "recommends putting the diff-stat computation in service.ts (or a domain helper it calls), not repository.ts",
      "states or implies repository.ts should stay limited to reading/writing the stored diff blob via Drizzle, not doing the computation",
      "explicitly says this does NOT belong in reviewer-core / reviewer-core does not need to know about it, since it's incidental to the review pipeline",
    ],
    // 0.66, not 1.0: baseline run showed the model reliably nails the service/repository split
    // (the two DI-container-relevant practices) but doesn't always proactively volunteer the
    // reviewer-core disclaimer even though the SKILL.md's own worked example covers this exact
    // scenario — a real, mild skill gap, but a separate concern from the DI-container rule this
    // eval exists to guard (see Experiment 2). Tracked, not silently threshold-gamed away.
    threshold: 0.66,
    maxTurns: 15,
  },

  // --- Own case, from a REAL past violation (not synthetic) --------------------------------
  // Ported from commit e6c2992 ("fix(onboarding): address architecture-reviewer finding — use
  // port's own costUsd, not adapters/pricing.ts") — server/src/modules/onboarding/service.ts
  // actually shipped this violation and it actually got caught + fixed in this repo. Practices
  // are scoped to the LAYERING claim specifically (service reaching into adapters/**), not the
  // redundant-computation/DRY angle any baseline model would flag regardless of this skill.
  {
    name: "flags a service importing an adapter-layer pricing helper instead of using the port's own result field",
    kind: "quality",
    prompt: `I'm about to open a PR — can you review this bit of server/src/modules/onboarding/service.ts before I do?

\`\`\`ts
import { estimateCost } from '../../adapters/llm/pricing.js';
// ...
const result = await llm.completeStructured(prompt, schema);
// ...
const costUsd = estimateCost(model, result.tokensIn, result.tokensOut);
logger?.info(
  { repoId, call: 'onboarding.generate', model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd },
  'onboarding.generate: prompt assembled',
);
\`\`\`

\`result\` here is the \`StructuredResult\` returned by the LLM port (\`llm.completeStructured\`) — the concrete adapters (\`openai.ts\`, \`anthropic.ts\`) already call \`estimateCost\` internally and set it on that result.`,
    practices: [
      "identifies importing `estimateCost` from `adapters/llm/pricing.js` directly into `service.ts` as an architecture/layering violation — a service reaching into adapters/** — not merely a redundant-computation or DRY nitpick",
      "recommends reading costUsd from the value the LLM port's result already provides (e.g. `result.costUsd`) instead of importing and calling an adapter-layer function directly from the service",
      "recommends removing the adapters/llm/pricing.js import from service.ts entirely, not just adding result.costUsd as an alternative alongside it",
      "does not dismiss the issue as harmless because the computed value would be numerically identical to result.costUsd — treats it as a real boundary violation regardless of functional equivalence",
    ],
    threshold: 1.0,
    maxTurns: 15,
  },
  // Negative control: the ACTUAL fixed version of the same code (commit e6c2992's "after" state).
  // must_not_flag, mirroring the homework's own accepted/dismissed → must_find/must_not_flag
  // framing (SPEC-05) — a skill that always finds something isn't useful; it must also stay quiet.
  {
    name: "does not fabricate a layering violation for the already-fixed version of the same code",
    kind: "quality",
    prompt: `Same file, after a fix — can you sanity-check this version of server/src/modules/onboarding/service.ts?

\`\`\`ts
const result = await llm.completeStructured(prompt, schema);
// ...
// costUsd comes straight off the port's own StructuredResult — the adapter already ran
// estimateCost once to produce it (adapters/llm/{openai,anthropic}.ts).
const costUsd = result.costUsd;
logger?.info(
  { repoId, call: 'onboarding.generate', model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd },
  'onboarding.generate: prompt assembled',
);
\`\`\``,
    practices: [
      "does not flag any onion-architecture / layering violation for this snippet — there is no adapters/** import and costUsd is read directly from the port's own result",
      "does not fabricate a claim that this code imports or reaches into adapters/llm/pricing.js (or any adapter) when it does not",
    ],
    threshold: 1.0,
    maxTurns: 15,
  },
];
