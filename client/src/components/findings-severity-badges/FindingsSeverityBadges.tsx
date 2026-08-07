"use client";

import React from "react";
import { Icon, SEV } from "@devdigest/ui";
import { FindingsTooltip, SEVERITY_DISPLAY_ORDER } from "@/components/findings-tooltip";
import type { FindingsSummary } from "@devdigest/shared";

/**
 * Per-severity finding counts with a hover tooltip listing each one —
 * extracted from `PRRow`'s original inline markup so `VerdictBanner`
 * (PR-level "PR Brief" usage) can render the exact same badges the PR list
 * already shows, instead of duplicating/re-deriving the counts differently.
 * `data-testid`s are unchanged from the original PRRow markup.
 */
export function FindingsSeverityBadges({ summary }: { summary: FindingsSummary | null | undefined }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      {SEVERITY_DISPLAY_ORDER.map((sev) => {
        const items = summary?.items.filter((f) => f.severity === sev) ?? [];
        const count = summary?.counts[sev] ?? 0;
        const SevIcon = Icon[SEV[sev].icon];
        return (
          <FindingsTooltip key={sev} findings={items}>
            <span
              data-testid={`pr-findings-badge-${sev}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                color: SEV[sev].c,
                borderBottom: `1px dotted ${SEV[sev].c}`,
                paddingBottom: 2,
              }}
            >
              <SevIcon size={12} />
              {count}
            </span>
          </FindingsTooltip>
        );
      })}
    </div>
  );
}
