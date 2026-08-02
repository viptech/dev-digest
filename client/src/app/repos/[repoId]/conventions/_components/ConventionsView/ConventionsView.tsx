"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, SelectInput, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [errorId, setErrorId] = React.useState<string | null>(null);
  const [samplingMode, setSamplingMode] = React.useState<"code" | "llm">("code");

  const setStatus = async (id: string, status: "accepted" | "rejected") => {
    setBusyId(id);
    setErrorId(null);
    try {
      await update.mutateAsync({ id, patch: { status } });
    } catch {
      setErrorId(id);
    } finally {
      setBusyId(null);
    }
  };

  const repoName = activeRepo?.full_name ?? t("page.repoFallback");

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SelectInput
              value={samplingMode}
              onChange={(v) => setSamplingMode(v as "code" | "llm")}
              options={[
                { value: "code", label: t("page.samplingModeCode") },
                { value: "llm", label: t("page.samplingModeLlm") },
              ]}
              mono={false}
            />
            <Button
              kind="primary"
              size="sm"
              icon="RefreshCw"
              onClick={() => extract.mutate(samplingMode)}
              disabled={extract.isPending}
            >
              {extract.isPending
                ? t("page.scanning")
                : (candidates?.length ?? 0) > 0
                  ? t("page.rescan")
                  : t("page.runExtraction")}
            </Button>
          </div>
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={100} />
            <Skeleton height={100} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {extract.isError && (
          <ErrorState body={t("page.extractionFailed")} onRetry={() => extract.mutate(samplingMode)} />
        )}
        {!isLoading && !isError && (candidates?.length ?? 0) === 0 && !extract.isPending && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => extract.mutate(samplingMode)}
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
                  repoFullName={activeRepo?.full_name}
                  defaultBranch={activeRepo?.default_branch}
                  onSetStatus={(status) => setStatus(c.id, status)}
                  onSaveRule={(rule) => update.mutate({ id: c.id, patch: { rule } })}
                  busy={busyId === c.id}
                  error={errorId === c.id ? t("card.acceptFailed") : undefined}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
