"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useRepoContextDocs, useContextDocContent } from "@/lib/hooks/project-context";
import type { ProjectContextCategory } from "@devdigest/shared";
import { s } from "./styles";

const CATEGORY_COLOR: Record<ProjectContextCategory, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

/**
 * /repos/:repoId/context — Project Context page (SPEC-01). Browse every
 * discovered `.md` document (AC-1, AC-2, AC-3) and preview one's full text
 * + "Used by N agents" (direct-attachment only, Goals). Deliberately no
 * Coverage% donut, no Indexed/chunks status row, no add/upload buttons —
 * all explicit Non-goals (those belong to a future, separate auto-selector
 * feature, not this manual-attach one).
 */
export function ProjectContextPage() {
  const t = useTranslations("projectContext");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: docs, isLoading, isError, refetch } = useRepoContextDocs(repoId);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const selected = (docs ?? []).find((d) => d.path === selectedPath) ?? docs?.[0];
  React.useEffect(() => {
    if (!selectedPath && docs && docs.length > 0) setSelectedPath(docs[0]!.path);
  }, [docs, selectedPath]);

  const { data: content, isLoading: contentLoading } = useContextDocContent(
    repoId,
    selected?.path ?? null,
  );

  const repoName = activeRepo?.full_name ?? "";

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName }, { label: t("pageTitle") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: repoName }, { label: t("pageTitle") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("pageTitle")}</h1>
            <p style={s.subtitle}>{t("pageSubtitle")}</p>
          </div>
          <Button kind="secondary" icon="RefreshCw" onClick={() => refetch()} loading={isLoading}>
            {t("refresh")}
          </Button>
        </div>

        {isLoading ? (
          <Skeleton />
        ) : isError ? (
          <ErrorState title={t("loadError")} onRetry={() => refetch()} />
        ) : !docs || docs.length === 0 ? (
          <EmptyState title={t("emptyDiscoveryTitle")} body={t("emptyDiscoveryBody")} />
        ) : (
          <div style={s.layout}>
            <div style={s.list}>
              {docs.map((doc) => (
                <div
                  key={doc.path}
                  style={s.listRow(doc.path === selected?.path)}
                  onClick={() => setSelectedPath(doc.path)}
                >
                  <span style={s.listPath}>{doc.path}</span>
                  <Badge color={CATEGORY_COLOR[doc.category]}>{doc.category}</Badge>
                </div>
              ))}
            </div>
            <div style={s.detail}>
              {selected && (
                <>
                  <div style={s.detailHeader}>
                    <span style={s.detailPath}>{selected.path}</span>
                    <Badge color={CATEGORY_COLOR[selected.category]}>{selected.category}</Badge>
                    <span style={s.usedBy}>{t("usedBy", { n: selected.used_by_agents })}</span>
                  </div>
                  {contentLoading ? <Skeleton /> : <Markdown>{content?.content ?? ""}</Markdown>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
