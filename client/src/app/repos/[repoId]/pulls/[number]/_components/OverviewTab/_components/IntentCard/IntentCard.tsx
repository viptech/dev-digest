"use client";

import React from "react";
import type { PrIntentRecord } from "@devdigest/shared";
import { SectionLabel, Badge } from "@devdigest/ui";
import { s } from "./styles";

interface IntentCardProps {
  intent: PrIntentRecord;
}

/**
 * Intent Layer display — the synthesized `intent` + in/out-of-scope lists,
 * with a visible confidence indicator so a reviewer immediately sees when the
 * intent was SYNTHESIZED (low confidence, `source: "inferred"`) rather than
 * stated directly (description/linked issue/plan-spec).
 */
export function IntentCard({ intent }: IntentCardProps) {
  const high = intent.confidence === "high";
  return (
    <section>
      <SectionLabel
        icon="Sparkles"
        right={
          <Badge
            icon={high ? "CheckCircle" : "AlertTriangle"}
            color={high ? "var(--info)" : "var(--warn)"}
            bg={high ? "var(--info-bg)" : "var(--warn-bg)"}
          >
            {high ? "High confidence" : "Inferred — low confidence"}
          </Badge>
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
