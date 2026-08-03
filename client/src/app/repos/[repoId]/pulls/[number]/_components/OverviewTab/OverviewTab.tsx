"use client";

import React from "react";
import type { PrIntentRecord } from "@devdigest/shared";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  intent?: PrIntentRecord | null;
}

export function OverviewTab({ prBody, intent }: OverviewTabProps) {
  return (
    <>
      {intent && <IntentCard intent={intent} />}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
