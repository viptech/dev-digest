"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);
  const [acceptingId, setAcceptingId] = React.useState<string | null>(null);

  const accept = async (id: string) => {
    setAcceptingId(id);
    await update.mutateAsync({ id, patch: { accepted: true } });
    setAcceptingId(null);
  };

  const repoName = activeRepo?.full_name ?? t("page.repoFallback");

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              {repoName}
            </h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <Button
            kind="primary"
            size="sm"
            icon="RefreshCw"
            onClick={() => extract.mutate()}
            disabled={extract.isPending}
          >
            {extract.isPending
              ? t("page.scanning")
              : (candidates?.length ?? 0) > 0
                ? t("page.rescan")
                : t("page.runExtraction")}
          </Button>
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={100} />
            <Skeleton height={100} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {extract.isError && <ErrorState body={t("page.extractionFailed")} onRetry={() => extract.mutate()} />}
        {!isLoading && !isError && (candidates?.length ?? 0) === 0 && !extract.isPending && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => extract.mutate()}
          />
        )}
        {(candidates?.length ?? 0) > 0 && (
          <>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              {t("page.candidateCount", { count: candidates!.length })}
            </p>
            <div style={s.grid}>
              {candidates!.map((c) => (
                <ConventionCard
                  key={c.id}
                  candidate={c}
                  onAccept={() => accept(c.id)}
                  accepting={acceptingId === c.id}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
