"use client";

import React from "react";
import type { PrIntentRecord, Risk, RiskSeverity } from "@devdigest/shared";
import { Icon, SectionLabel, Badge, Button } from "@devdigest/ui";
import { useRefreshIntent } from "../../../../../../../../../lib/hooks/reviews";
import { notify } from "../../../../../../../../../lib/toast";
import { s, chevronFor } from "./styles";

interface IntentAndRiskCardProps {
  /** `null` when the PR has no Intent classification yet (SPEC-01/03's own
   *  Edge cases: Intent is never a hard precondition for Brief's `risks[]`
   *  either) — the intent/scope block is skipped entirely, not rendered
   *  empty. */
  intent: PrIntentRecord | null;
  /** SPEC-04's `Brief.risks` — grounded (`file_refs` already filtered
   *  against the PR's real changed files/endpoints) before this component
   *  ever sees them; nothing here re-validates that. */
  risks?: Risk[];
  prId: string | null | undefined;
}

/** Same three CSS variables `PrBriefCard`'s risk-level badge uses (SPEC-04
 *  T8) — one shared color vocabulary for "risk" across both cards. */
const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--info)",
};

/** `Risk.kind` is a free-form string (no enum in this codebase, SPEC-04
 *  cross-model review finding m6) — a small icon lookup for the kinds the
 *  prompt's own examples use, with a generic fallback for anything else. */
const KIND_ICON: Record<string, keyof typeof Icon> = {
  security: "Shield",
  "data-loss": "AlertOctagon",
  "breaking-change": "Zap",
  performance: "Gauge",
};

/**
 * Intent Layer display (Intent + in/out-of-scope, unchanged from before this
 * feature) plus SPEC-04's `Brief.risks[]`, rendered as collapsible chips
 * below it — renamed from `IntentCard` since it now owns two related but
 * distinct sections in one bordered card, not a single-purpose one (same
 * "one card, several internal sections" shape `BlastRadiusCard` already
 * uses for banner/body).
 */
export function IntentAndRiskCard({ intent, risks, prId }: IntentAndRiskCardProps) {
  const [openChips, setOpenChips] = React.useState<Set<number>>(() => new Set());
  const refresh = useRefreshIntent(prId);

  const hasRisks = (risks?.length ?? 0) > 0;
  if (!intent && !hasRisks) return null;

  const toggleChip = (i: number) =>
    setOpenChips((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const high = intent?.confidence === "high";

  return (
    <section>
      <SectionLabel
        icon="Sparkles"
        right={
          intent && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge
                icon={high ? "CheckCircle" : "AlertTriangle"}
                color={high ? "var(--info)" : "var(--warn)"}
                bg={high ? "var(--info-bg)" : "var(--warn-bg)"}
              >
                {high ? "High confidence" : "Inferred — low confidence"}
              </Badge>
              <Button
                kind="ghost"
                size="sm"
                icon="RefreshCw"
                loading={refresh.isPending}
                disabled={!prId}
                onClick={() =>
                  refresh.mutate(undefined, {
                    onError: (err) => notify.error((err as Error).message),
                  })
                }
              >
                Re-derive
              </Button>
            </div>
          )
        }
      >
        Intent
      </SectionLabel>
      <div style={s.card}>
        {intent && (
          <>
            <p style={s.intentText}>{intent.intent}</p>
            {intent.in_scope.length > 0 && (
              <div style={s.scopeBlock}>
                <div style={s.scopeLabel}>In scope</div>
                <ul style={s.scopeList}>
                  {intent.in_scope.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {intent.out_of_scope.length > 0 && (
              <div style={s.scopeBlock}>
                <div style={s.scopeLabel}>Out of scope</div>
                <ul style={s.scopeList}>
                  {intent.out_of_scope.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={s.meta}>
              Source: {intent.source.replace("_", " ")}
              {intent.plan_ref ? ` · ${intent.plan_ref}` : ""}
            </div>
          </>
        )}
        {hasRisks && (
          <div style={s.risksBlock}>
            <div style={s.risksLabel}>Risk areas</div>
            {risks!.map((risk, i) => {
              const open = openChips.has(i);
              const IconComp = Icon[KIND_ICON[risk.kind] ?? "AlertTriangle"];
              const firstRef = risk.file_refs[0];
              return (
                <div key={`${risk.kind}-${risk.title}-${i}`} style={s.riskChip}>
                  <div
                    style={s.riskChipHeader}
                    onClick={() => toggleChip(i)}
                    role="button"
                    aria-expanded={open}
                  >
                    <Icon.ChevronRight size={13} style={chevronFor(open)} />
                    <IconComp size={13} style={{ color: SEVERITY_COLOR[risk.severity], flexShrink: 0 }} />
                    <span style={s.riskChipTitle}>{risk.title}</span>
                    {firstRef && (
                      <span className="mono" style={s.riskChipRef}>
                        {firstRef}
                      </span>
                    )}
                  </div>
                  {open && <div style={s.riskChipBody}>{risk.explanation}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
