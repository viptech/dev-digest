"use client";

import React from "react";
import type { PrIntentRecord } from "@devdigest/shared";
import { SectionLabel } from "@devdigest/ui";
import { useIntent } from "@/lib/hooks/reviews";
import { IntentCard } from "./_components/IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null | undefined;
  prBody: string | null | undefined;
  /** Seeds useIntent's cache — the `intent` already embedded in PrDetail. */
  intent?: PrIntentRecord | null;
}

export function OverviewTab({ prId, prBody, intent }: OverviewTabProps) {
  const { data } = useIntent(prId, intent);
  return (
    <>
      {data && <IntentCard intent={data} prId={prId} />}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
