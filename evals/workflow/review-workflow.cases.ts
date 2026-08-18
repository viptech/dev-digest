import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (root CLAUDE.md + skills +
 * subagents, loaded via settingSources:["project"]) behaves as documented. Organized by
 * scenario, not by a single artifact, because these behaviors are cross-cutting.
 *
 * Retargeted from the upstream/l06-evals template: the original cases pointed at
 * server/docs/api-contracts.md, reviewer-core/docs/pipeline.md, and
 * reviewer-core/insights/gotchas.md — none of which exist in this repo (root CLAUDE.md's real
 * "Read when" table routes to server/README.md, reviewer-core/README.md, TESTING.md instead).
 * See run-evals/04-experiment-4-workflow.md.
 *
 * Budget: 5 Claude sessions total.
 *   - 1 × trace (doc routing + subagent dispatch, one session, stops early once both land)
 *   - 1 × activation pair (positive + near-miss negative) = 2 sessions
 *   - 1 × contrast (CLAUDE.md-routed test-conventions doc: treatment vs empty-dir control) = 2 sessions
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): "Read when: touching server/**" routing + architecture-reviewer dispatch, together
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    name: "API-route task reads server/README.md AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з довідкою по API цього репо (server/README.md — API map, request/DI " +
      "flow). Потім ОБОВʼЯЗКОВО запусти сабагента architecture-reviewer, щоб він оцінив мій план на " +
      "відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/README.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    // 4 was too tight: with real project context the model spends turns grounding the insight in
    // an actual file:line before invoking the skill (matches this repo's own engineering-insights
    // convention) — it was still mid-investigation, not stuck, when the budget ran out.
    maxTurns: 8,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },

  // --- contrast (2 sessions): control/treatment for root CLAUDE.md's "Writing or debugging any
  // test -> TESTING.md" routing row. Treatment runs in the real repo (settingSources:["project"]),
  // so it can discover and read TESTING.md via CLAUDE.md's own routing table. Control runs in an
  // empty tmpdir with NO settingSources (no CLAUDE.md, no repo structure at all to discover
  // TESTING.md's existence or path) — it genuinely cannot read a file it has no way to know exists,
  // unlike the earlier gotchas.md attempt this replaces (which control could still reach by an
  // absolute path leaked into context). The prompt below names no path at all, on purpose.
  {
    kind: "contrast",
    name: "CLAUDE.md routes a test-writing task to TESTING.md (control has no such routing to follow)",
    prompt:
      "Я збираюся написати новий тест для модуля pulls. Перш ніж писати код тесту — звірся з " +
      "настановами цього репозиторію щодо того, яку документацію треба прочитати перед написанням " +
      "тестів, і прочитай саме той документ.",
    expectFileRead: "TESTING.md",
    maxTurns: 8,
  },
];
