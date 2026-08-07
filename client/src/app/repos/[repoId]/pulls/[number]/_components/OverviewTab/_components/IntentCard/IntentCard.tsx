"use client";

import React from "react";
import type { PrIntentRecord } from "@devdigest/shared";
import { SectionLabel, Badge, Button } from "@devdigest/ui";
import { useRefreshIntent } from "../../../../../../../../../lib/hooks/reviews";
import { notify } from "../../../../../../../../../lib/toast";
import { s } from "./styles";

interface IntentCardProps {
  intent: PrIntentRecord;
  prId: string | null | undefined;
}

/**
 * Intent Layer display — the synthesized `intent` + in/out-of-scope lists,
 * with a visible confidence indicator so a reviewer immediately sees when the
 * intent was SYNTHESIZED (low confidence, `source: "inferred"`) rather than
 * stated directly (description/linked issue/plan-spec). The refresh button
 * covers the case the automatic recompute-on-new-commit can't: the user
 * edited the PR description (or a linked issue/plan) without pushing a new
 * commit, so `head_sha` didn't change but the classifier's input did.
 */
export function IntentCard({ intent, prId }: IntentCardProps) {
  const high = intent.confidence === "high";
  const refresh = useRefreshIntent(prId);
  return (
    <section>
      <SectionLabel
        icon="Sparkles"
        right={
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
        }
      >
        Intent
      </SectionLabel>
      <div style={s.card}>
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
      </div>
    </section>
  );
}
