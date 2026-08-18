import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./architecture-reviewer-strict.cases.js";

// Targets .claude/agents/architecture-reviewer-strict.md — an EVAL-ONLY copy of
// exapmle_claude/.claude/agents/architecture-reviewer.md (rule-ID-based), NOT the repo's real
// production architecture-reviewer.md (prose-based, no rule IDs). See Experiment 3 (run-evals/).
describeAgent("architecture-reviewer-strict", () => runAgentCases("architecture-reviewer-strict", cases));
