"use client";

import React from "react";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";

/**
 * Preview tab (SPEC-06 G3, Development Plan `skill-editor.md` Step 7.2) —
 * renders `skill.body` exactly as the model would see it via the already-
 * safe `<Markdown>` (`@devdigest/ui`). Read-only: no textarea, no edit
 * affordance — editing `body` lives exclusively in `ConfigTab` (AC-8, AC-9).
 *
 * `<Markdown>` needs no new sanitizer here: `react-markdown` without
 * `rehype-raw` already renders any raw HTML (e.g. a literal `<script>` in an
 * untrusted/imported skill's body) as inert visible text, not a real DOM
 * node (client INSIGHTS.md 2026-08-13).
 */
export function PreviewTab({ skill }: { skill: Skill }) {
  return (
    <div style={{ maxWidth: 760 }}>
      <Markdown>{skill.body}</Markdown>
    </div>
  );
}
