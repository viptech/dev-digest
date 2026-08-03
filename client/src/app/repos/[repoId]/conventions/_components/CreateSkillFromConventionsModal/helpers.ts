import type { ConventionCandidate } from "@devdigest/shared";

/** Render accepted convention candidates into a starting Markdown skill body. */
export function buildSkillBody(accepted: ConventionCandidate[]): string {
  const lines = accepted.map((c) => {
    const evidence = c.evidence_path
      ? ` (${c.evidence_path}${c.evidence_line ? `:${c.evidence_line}` : ""})`
      : "";
    return `- ${c.rule}${evidence}`;
  });
  return `# repo-conventions\n\n${lines.join("\n")}\n`;
}
