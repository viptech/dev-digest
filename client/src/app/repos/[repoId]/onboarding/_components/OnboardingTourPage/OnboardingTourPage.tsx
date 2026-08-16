"use client";

/* OnboardingTourPage — /repos/:repoId/onboarding (SPEC-03, Onboarding
   Generator). Three UI states: empty (AC-13, no tour generated yet),
   degraded (AC-8/AC-9, shown only from a `useGenerateOnboarding` mutation
   result — the server never persists a degraded generation, so a page
   refresh always reverts to empty, by design), and populated (AC-17, five
   independently-collapsible per-`kind` cards + an "ON THIS PAGE" anchor nav). */

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { OnboardingResponse, OnboardingSection } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useOnboarding, useGenerateOnboarding } from "@/lib/hooks/onboarding";
import { SECTION_KIND_ICON, type OnboardingSectionKind } from "./constants";
import { formatRelativeTime, orderedSections, sectionId } from "./helpers";
import { ArchitectureSection } from "./_components/ArchitectureSection";
import { CriticalPathsSection } from "./_components/CriticalPathsSection";
import { LocalSetupSection } from "./_components/LocalSetupSection";
import { ReadingOrderSection } from "./_components/ReadingOrderSection";
import { FirstTasksSection } from "./_components/FirstTasksSection";
import { s } from "./styles";

function scrollToSection(kind: string) {
  const el = document.getElementById(sectionId(kind));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

function KindBody({
  kind,
  section,
  repoFullName,
  defaultBranch,
}: {
  kind: OnboardingSectionKind;
  section: OnboardingSection;
  repoFullName?: string | null;
  defaultBranch?: string | null;
}) {
  switch (kind) {
    case "architecture":
      return <ArchitectureSection section={section} />;
    case "critical_paths":
      return (
        <CriticalPathsSection section={section} repoFullName={repoFullName} defaultBranch={defaultBranch} />
      );
    case "local_setup":
      return <LocalSetupSection section={section} />;
    case "reading_order":
      return (
        <ReadingOrderSection section={section} repoFullName={repoFullName} defaultBranch={defaultBranch} />
      );
    case "first_tasks":
      return (
        <FirstTasksSection section={section} repoFullName={repoFullName} defaultBranch={defaultBranch} />
      );
    default:
      return null;
  }
}

/** One collapsible card. Collapse state is colocated here — never lifted —
 *  so toggling one card never touches the others (react-best-practices). */
function SectionCard({
  kind,
  section,
  repoFullName,
  defaultBranch,
}: {
  kind: OnboardingSectionKind;
  section: OnboardingSection;
  repoFullName?: string | null;
  defaultBranch?: string | null;
}) {
  const t = useTranslations("onboarding");
  const [open, setOpen] = React.useState(true);
  const KindIcon = Icon[SECTION_KIND_ICON[kind]];

  return (
    <div id={sectionId(kind)} tabIndex={-1} style={s.card}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={s.cardHeader}
      >
        <KindIcon size={16} style={{ color: "var(--text-muted)" }} />
        <span style={s.cardTitle}>{section.title || t(`kinds.${kind}`)}</span>
        <Icon.ChevronDown
          size={16}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--text-muted)" }}
        />
      </div>
      {open && (
        <div style={s.cardBody}>
          <KindBody kind={kind} section={section} repoFullName={repoFullName} defaultBranch={defaultBranch} />
        </div>
      )}
    </div>
  );
}

export function OnboardingTourPage() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: persisted, isLoading, isError, refetch } = useOnboarding(repoId);
  const generate = useGenerateOnboarding(repoId);

  // A degraded generation is NEVER persisted (AC-12) — it only ever exists as
  // this mutation's own transient result, held here for as long as it stays
  // the most recent outcome. A refresh loses it by design (see file header).
  const [transient, setTransient] = React.useState<OnboardingResponse | null>(null);
  const [copied, setCopied] = React.useState(false);

  const handleGenerate = () => {
    generate.mutate(undefined, {
      onSuccess: (data) => setTransient(data.degraded ? data : null),
    });
  };

  const handleShare = () => {
    void navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const repoName = activeRepo?.full_name ?? "";
  const display = transient ?? persisted ?? null;

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("title") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("title") }]}>
      <div style={s.page}>
        {isLoading ? (
          <Skeleton height={160} />
        ) : isError ? (
          <ErrorState title={t("loadError.title")} onRetry={() => refetch()} />
        ) : !display ? (
          <EmptyState
            icon="Workflow"
            title={t("generate.title")}
            body={t("generate.body")}
            cta={generate.isPending ? t("generate.generating") : t("generate.cta")}
            onCta={handleGenerate}
            ctaLoading={generate.isPending}
          />
        ) : (
          <>
            <div style={s.header}>
              <div style={s.headerText}>
                <h1 style={s.h1}>{t("headerTitle", { repo: repoName })}</h1>
                <p style={s.subtitle}>
                  {t("lastRefreshed", { time: formatRelativeTime(display.generated_at) })}
                </p>
              </div>
              <div style={s.headerActions}>
                <Button kind="secondary" icon="RefreshCw" onClick={handleGenerate} loading={generate.isPending}>
                  {generate.isPending ? t("regenerating") : t("regenerate")}
                </Button>
                <Button kind="secondary" icon={copied ? "Check" : "Link"} onClick={handleShare}>
                  {copied ? t("linkCopied") : t("shareLink")}
                </Button>
              </div>
            </div>

            {display.degraded && (
              <div role="status" style={s.banner}>
                <Icon.AlertTriangle size={16} />
                <span>{t(`degraded.banner.${display.degraded_reason ?? "no_data"}`)}</span>
              </div>
            )}

            <div style={s.layout}>
              <nav style={s.nav} aria-label={t("onThisPage")}>
                <div style={s.navLabel}>{t("onThisPage")}</div>
                {orderedSections(display.sections).map(({ kind }) => {
                  const NavIcon = Icon[SECTION_KIND_ICON[kind]];
                  return (
                    <button
                      key={kind}
                      type="button"
                      style={s.navItem}
                      onClick={() => scrollToSection(kind)}
                    >
                      <NavIcon size={14} />
                      {t(`kinds.${kind}`)}
                    </button>
                  );
                })}
              </nav>

              <div style={s.cards}>
                {orderedSections(display.sections).map(({ kind, section }) => (
                  <SectionCard
                    key={kind}
                    kind={kind}
                    section={section}
                    repoFullName={activeRepo?.full_name}
                    defaultBranch={activeRepo?.default_branch}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
