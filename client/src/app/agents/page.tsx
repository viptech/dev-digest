"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";
import { EmptyState, ErrorState, Button, Skeleton } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { CreateAgentModal } from "./_components/CreateAgentModal";

/* Route: /agents — redirects straight into the Agent Editor for the first
   agent, same "load the list, land on item one" pattern as `/skills`'s
   `page.tsx` (itself modeled on the root `page.tsx`'s "redirect to first
   repo"). Opening Agents never shows a flat grid you have to click through
   first — `/agents/:id`'s own sidebar (the one `SkillEditorView`'s sidebar
   was in turn modeled on) IS the list now, with the detail already open.
   This page only ever paints its own UI for the states that have nowhere to
   redirect to yet: loading, load error, or zero agents (first-run empty
   state) — the former `AgentsListView` grid is gone; its `CreateAgentModal`
   moved up to `agents/_components/` since it now has two callers (this
   page's empty state, and the editor sidebar's "Add" action). */
export default function AgentsPage() {
  const t = useTranslations("agents");
  const router = useRouter();
  const { data: agents, isLoading, isError, refetch } = useAgents();
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (agents && agents.length > 0) {
      router.replace(`/agents/${agents[0]!.id}?tab=config`);
    }
  }, [agents, router]);

  const crumb = [{ label: t("list.breadcrumbLab") }, { label: t("list.breadcrumb") }];

  return (
    <AppShell crumb={crumb}>
      {creating && <CreateAgentModal onClose={() => setCreating(false)} />}
      <PageContainer title={t("list.title")} subtitle={t("list.subtitle")}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}>
            <Skeleton height={20} width={240} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : isError ? (
          <ErrorState body={t("list.loadError")} onRetry={() => refetch()} />
        ) : !agents || agents.length === 0 ? (
          <EmptyState
            icon="Cpu"
            title={t("list.emptyTitle")}
            body={t("list.emptyBody")}
            cta={t("list.emptyCta")}
            onCta={() => setCreating(true)}
          />
        ) : (
          <div>
            <p style={{ color: "var(--text-secondary)", marginBottom: 14 }}>{t("list.redirecting")}</p>
            <Button kind="primary" onClick={() => router.push(`/agents/${agents[0]!.id}?tab=config`)}>
              {t("list.open", { name: agents[0]!.name })}
            </Button>
          </div>
        )}
      </PageContainer>
    </AppShell>
  );
}
