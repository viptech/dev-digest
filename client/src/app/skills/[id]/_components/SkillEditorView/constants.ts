import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace
 *  (`skills.editor.tabs.*`). Mirrors `agents/[id]/_components/AgentEditor/
 *  constants.ts`'s shape exactly. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Skill editor tabs (SPEC-06 G1). Tab bodies wired in a later Development
 *  Plan step (Config/Preview/Context: Step 7; Evals: Step 5+10; Stats: Step
 *  8; Versions: Step 9) — this step only scaffolds the route + tab bar. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];
