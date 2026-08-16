"use client";

import React from "react";
import type { PrIntentRecord } from "@devdigest/shared";
import { SectionLabel } from "@devdigest/ui";
import { useIntent } from "@/lib/hooks/reviews";
import { useBrief } from "@/lib/hooks/brief";
import { PrBriefCard } from "./_components/PrBriefCard";
import { IntentAndRiskCard } from "./_components/IntentAndRiskCard";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { ReviewFocusCard } from "./_components/ReviewFocusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null | undefined;
  prBody: string | null | undefined;
  /** Seeds useIntent's cache — the `intent` already embedded in PrDetail. */
  intent?: PrIntentRecord | null;
  /** owner/repo — null until the repo is loaded. Gates BlastRadiusCard's
   *  GitHub deep-links (same reason as BlastTab's identical prop). */
  repoFullName: string | null;
  headSha: string | null;
  /** SPEC-04 (T10) — a Review Focus row was clicked; parent switches to
   *  Files changed and scrolls/highlights the target. */
  onOpenFile?: (path: string, line?: number | null) => void;
}

export function OverviewTab({ prId, prBody, intent, repoFullName, headSha, onOpenFile }: OverviewTabProps) {
  const { data } = useIntent(prId, intent);
  // Independent `useBrief` call — React Query dedupes on the shared
  // `["brief", prId]` key against `PrBriefCard`'s own call, so this is a
  // cache hit, never a second network request (same per-card-hook pattern
  // `BlastRadiusCard` already uses). Deliberately not lifted/prop-drilled
  // from a single parent fetch, to keep each card's data dependency
  // self-contained, matching this codebase's existing convention.
  const { data: brief } = useBrief(prId);
  return (
    <>
      <PrBriefCard prId={prId} />
      {(data || (brief?.brief?.risks?.length ?? 0) > 0) && (
        <IntentAndRiskCard intent={data ?? null} risks={brief?.brief?.risks} prId={prId} />
      )}
      <BlastRadiusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
      <ReviewFocusCard reviewFocus={brief?.brief?.review_focus} onOpenFile={onOpenFile} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
