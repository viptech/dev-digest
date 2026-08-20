import type { AgentVersionConfig } from "@devdigest/shared";

/** One non-prompt field that differs between two version snapshots. `from`/
 *  `to` are raw values — the component maps `key` to a label and formats
 *  the value (boolean → on/off, skill ids → count) via `t()`. */
export interface FieldChange {
  key: "provider" | "model" | "strategy" | "ciFailOn" | "repoIntel" | "skills";
  from: string | number | boolean;
  to: string | number | boolean;
}

/**
 * Non-prompt config differences between two agent-version snapshots, for the
 * compact "Also changed" list that sits next to the system-prompt diff.
 * Unlike a skill (whose version only ever tracks `body`), an agent version
 * snapshots the whole reviewer config (`AgentVersionConfig`) — restoring an
 * old version silently reverts provider/model/strategy/gate/repo-intel/
 * linked-skills too, so a viewer comparing two versions needs to see that,
 * not just the prompt text.
 *
 * Skills are compared as a set (`.sort().join(",")`) — a pure reorder isn't
 * a "change" here — and summarized as a count, not individual names:
 * resolving ids to names would need every skill fetched just to render a
 * compact indicator. `output_schema` is restored faithfully by the caller
 * but isn't surfaced here — it has no single-line-friendly rendering.
 */
export function fieldChanges(older: AgentVersionConfig, newer: AgentVersionConfig): FieldChange[] {
  const changes: FieldChange[] = [];
  if (older.provider !== newer.provider) changes.push({ key: "provider", from: older.provider, to: newer.provider });
  if (older.model !== newer.model) changes.push({ key: "model", from: older.model, to: newer.model });
  if (older.strategy !== newer.strategy) changes.push({ key: "strategy", from: older.strategy, to: newer.strategy });
  if (older.ci_fail_on !== newer.ci_fail_on)
    changes.push({ key: "ciFailOn", from: older.ci_fail_on, to: newer.ci_fail_on });
  if (older.repo_intel !== newer.repo_intel)
    changes.push({ key: "repoIntel", from: older.repo_intel, to: newer.repo_intel });
  const olderSkills = [...older.skills].sort().join(",");
  const newerSkills = [...newer.skills].sort().join(",");
  if (olderSkills !== newerSkills) {
    changes.push({ key: "skills", from: older.skills.length, to: newer.skills.length });
  }
  return changes;
}
