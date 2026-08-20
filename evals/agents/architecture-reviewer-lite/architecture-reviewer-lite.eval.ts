import { describeAgent, runAgentCases } from "../../src/index.js";
// Deliberately reuses the strict variant's cases — same fixture, same practices, same
// threshold. Only the injected agent artifact differs (.claude/agents/architecture-reviewer-lite.md
// has the "One rule citation per finding" hard rule removed relative to architecture-reviewer-strict.md
// — see Experiment 3, run-evals/). That is what makes this pair a controlled A/B rather than two
// unrelated evals: pnpm eval:repeat both with labels and pnpm eval:delta them to see exactly
// which practice moved.
import { cases } from "../architecture-reviewer-strict/architecture-reviewer-strict.cases.js";

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", cases));
