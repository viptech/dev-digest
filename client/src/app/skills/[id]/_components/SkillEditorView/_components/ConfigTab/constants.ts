import type { SkillType } from "@devdigest/shared";

/** Selectable skill types — mirrors `SkillDrawer.tsx`'s `TYPE_OPTIONS`
 *  (labels are the literal type value, not translated — same convention as
 *  the drawer's create/import form this tab replaces for editing). */
export const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "rubric" },
  { value: "convention", label: "convention" },
  { value: "security", label: "security" },
  { value: "custom", label: "custom" },
];
