"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, EmptyState } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentCi } from "@/lib/hooks/ci";
import { ExportWizard } from "./_components/ExportWizard";
import { statusI18nKey, findingsSummary } from "./helpers";
import { s } from "./styles";

/**
 * CI tab (SPEC-08 G11/G1) — Add-to-CI/Update-CI-config entry point into the
 * Export Wizard, a READ-ONLY "Fail CI on" passthrough of the agent's own
 * `ci_fail_on` (AC-32 — no independent state, edited only from the Config
 * tab via `onTab("config")`), and this agent's installations + CI run
 * history (AC-31/AC-33), backed by `GET /agents/:id/ci`.
 */
export function CiTab({ agent, onTab }: { agent: Agent; onTab: (tab: string) => void }) {
  const t = useTranslations("ci");
  const { data, isLoading } = useAgentCi(agent.id);
  const [wizardOpen, setWizardOpen] = React.useState(false);

  if (isLoading || !data) {
    return <div style={s.wrap}>{t("ciTab.loading")}</div>;
  }

  const hasInstallations = data.installations.length > 0;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h2 style={s.h2}>{t("ciTab.heading")}</h2>
          <p style={s.subtitle}>{t("ciTab.subtitle")}</p>
        </div>
        <Button kind="primary" icon="Workflow" onClick={() => setWizardOpen(true)}>
          {hasInstallations ? t("ciTab.updateCiConfig") : t("ciTab.addToCi")}
        </Button>
      </div>

      <div style={s.failRow}>
        <span>
          {t("ciTab.failCiOn")} <span style={s.failValue}>{data.ci_fail_on.toUpperCase()}</span>
        </span>
        <Button kind="ghost" size="sm" onClick={() => onTab("config")}>
          {t("ciTab.editInConfig")}
        </Button>
      </div>

      {!hasInstallations ? (
        <EmptyState
          icon="Workflow"
          title={t("ciTab.emptyTitle")}
          body={t("ciTab.emptyBody")}
          cta={t("ciTab.addToCi")}
          onCta={() => setWizardOpen(true)}
        />
      ) : (
        <>
          <div style={s.panel}>
            <div style={s.panelTitle}>{t("ciTab.installationsHeading")}</div>
            {data.installations.map((inst) => (
              <div key={inst.id} style={s.installRow}>
                <Badge color="var(--text-secondary)">{t(`exportWizard.targets.${inst.target_type}`)}</Badge>
                <span style={s.installRepo}>{inst.repo}</span>
                <div style={s.installMeta}>
                  <span>{t("ciTab.installed", { date: new Date(inst.installed_at).toLocaleDateString() })}</span>
                  {inst.workflow_version && (
                    <span>{t("ciTab.workflowVersion", { version: inst.workflow_version })}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={s.panel}>
            <div style={s.panelTitle}>{t("ciTab.runsHeading")}</div>
            {data.runs.length === 0 ? (
              <p style={s.muted}>{t("ciTab.noRuns")}</p>
            ) : (
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>{t("runs.table.timestamp")}</th>
                    <th style={s.th}>{t("runs.table.pullRequest")}</th>
                    <th style={s.th}>{t("runs.table.source")}</th>
                    <th style={s.th}>{t("runs.table.findings")}</th>
                    <th style={s.th}>{t("runs.table.cost")}</th>
                    <th style={s.th}>{t("runs.table.status")}</th>
                    <th style={s.th}>{t("runs.table.trace")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id}>
                      <td style={s.td}>{run.ran_at ? new Date(run.ran_at).toLocaleString() : "—"}</td>
                      <td style={s.td}>{run.pr_number != null ? `#${run.pr_number}` : "—"}</td>
                      <td style={s.td}>
                        <Badge color="var(--text-muted)">{run.source ?? "—"}</Badge>
                      </td>
                      <td style={s.td}>{findingsSummary(run)}</td>
                      <td style={s.td}>{run.cost_usd != null ? `$${run.cost_usd.toFixed(2)}` : "—"}</td>
                      <td style={s.td}>{t(`runs.status.${statusI18nKey(run.status)}`)}</td>
                      <td style={s.td}>
                        {run.github_url ? (
                          <a href={run.github_url} target="_blank" rel="noopener" style={s.traceLink}>
                            {t("runs.view")}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {wizardOpen && <ExportWizard agent={agent} onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
