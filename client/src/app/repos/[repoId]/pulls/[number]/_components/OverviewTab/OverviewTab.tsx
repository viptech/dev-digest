"use client";

import React from "react";
import type { PrIntentRecord } from "@devdigest/shared";
import { SectionLabel } from "@devdigest/ui";
import { useIntent } from "@/lib/hooks/reviews";
import { PrBriefCard } from "./_components/PrBriefCard";
import { IntentCard } from "./_components/IntentCard";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
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
}

export function OverviewTab({ prId, prBody, intent, repoFullName, headSha }: OverviewTabProps) {
  const { data } = useIntent(prId, intent);
  return (
    <>
      <PrBriefCard prId={prId} />
      {data && <IntentCard intent={data} prId={prId} />}
      <BlastRadiusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
