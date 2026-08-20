"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";
import { EmptyState, ErrorState, Button, Skeleton } from "@devdigest/ui";
import { useSkills } from "@/lib/hooks/skills";
import { SkillDrawer } from "./_components/SkillDrawer";

/* Route: /skills — redirects straight into the Skill Editor for the first
   skill, same "load the list, land on item one" pattern as the root
   `page.tsx`'s "redirect to first repo" (`router.replace` in a useEffect
   once the list resolves). Opening Skills Lab never shows a flat grid you
   have to click through first — `/skills/:id`'s own sidebar (added to
   `SkillEditorView` alongside its detail pane) IS the list now, with the
   detail already open. This page only ever paints its own UI for the
   states that have nowhere to redirect to yet: loading, load error, or
   zero skills (first-run empty state) — the former `SkillsListView` grid
   is gone; `filterSkills` moved with its only remaining caller into
   `SkillEditorView/helpers.ts`. */
export default function SkillsPage() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const [mode, setMode] = React.useState<"none" | "create" | "import">("none");

  React.useEffect(() => {
    if (skills && skills.length > 0) {
      router.replace(`/skills/${skills[0]!.id}?tab=config`);
    }
  }, [skills, router]);

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }];

  return (
    <AppShell crumb={crumb}>
      {mode !== "none" && <SkillDrawer mode={mode} onClose={() => setMode("none")} />}
      <PageContainer title={t("page.heading")}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}>
            <Skeleton height={20} width={240} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : isError ? (
          <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
        ) : !skills || skills.length === 0 ? (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setMode("import")}
          />
        ) : (
          <div>
            <p style={{ color: "var(--text-secondary)", marginBottom: 14 }}>{t("page.redirecting")}</p>
            <Button kind="primary" onClick={() => router.push(`/skills/${skills[0]!.id}?tab=config`)}>
              {t("page.open", { name: skills[0]!.name })}
            </Button>
          </div>
        )}
      </PageContainer>
    </AppShell>
  );
}
