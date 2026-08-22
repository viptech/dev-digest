"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Icon, ExportWizardSteps } from "@devdigest/ui";
import type { Agent, CiExport, CiFile } from "@devdigest/shared";
import { useExportCi } from "@/lib/hooks/ci";
import { ApiError } from "@/lib/api";
import { WIZARD_STEP_KEYS } from "./constants";
import { DEFAULT_TRIGGERS, buildExportInput, downloadFilesAsZip, noTriggersSelected, type InstallMethod, type PostAs, type TriggerState } from "./helpers";
import { TargetStep } from "./_components/TargetStep";
import { PreviewStep } from "./_components/PreviewStep";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep } from "./_components/InstallStep";
import { s } from "./styles";

/**
 * Export Wizard (SPEC-08 G1-G6) — Target → Preview → Configure → Install,
 * reusing `ExportWizardSteps` as-is (`step`+`labels`, per the plan). One
 * `useExportCi` mutation backs both the Preview fetch (`action: 'files'`,
 * fired on every ENTRY into the Preview step — forward from Target and
 * backward from Configure — so it always reflects the wizard's current
 * trigger/post_as state) and the final Install submit.
 */
export function ExportWizard({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const t = useTranslations("ci");
  const exportCi = useExportCi(agent.id);

  const [step, setStep] = React.useState(0);
  const [repo, setRepo] = React.useState("");
  const [triggers, setTriggers] = React.useState<TriggerState>(DEFAULT_TRIGGERS);
  const [postAs, setPostAs] = React.useState<PostAs>("github_review");
  const [installMethod, setInstallMethod] = React.useState<InstallMethod>("open_pr");

  const [previewFiles, setPreviewFiles] = React.useState<CiFile[] | undefined>(undefined);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [selectedFilePath, setSelectedFilePath] = React.useState<string | null>(null);
  const [editedContents, setEditedContents] = React.useState<Record<string, string>>({});

  const [installResult, setInstallResult] = React.useState<CiExport | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const toErrorMessage = (err: unknown) => (err instanceof ApiError ? err.message : t("exportWizard.genericError"));

  const enterPreview = async () => {
    setStep(1);
    setPreviewLoading(true);
    setErrorMessage(null);
    try {
      const res = await exportCi.mutateAsync(buildExportInput({ repo, action: "files", postAs, triggers }));
      setPreviewFiles(res.files);
      setSelectedFilePath(res.files[0]?.path ?? null);
      // A fresh Preview fetch reflects the server's current generated
      // content for the (possibly changed) trigger/post_as state — any edits
      // made against the PRIOR fetch no longer necessarily apply verbatim
      // (e.g. the workflow.yml's own generated body changed). Clearing here
      // avoids silently reapplying stale edits on top of new content.
      setEditedContents({});
    } catch (err) {
      setErrorMessage(toErrorMessage(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleInstall = async () => {
    setErrorMessage(null);
    try {
      const res = await exportCi.mutateAsync(
        buildExportInput({
          repo,
          action: installMethod === "open_pr" ? "open_pr" : "files",
          postAs,
          triggers,
          editedContents,
        }),
      );
      if (installMethod === "files") {
        downloadFilesAsZip(res.files);
      }
      setInstallResult(res);
    } catch (err) {
      setErrorMessage(toErrorMessage(err));
    }
  };

  const toggleTrigger = (key: keyof TriggerState) => setTriggers((prev) => ({ ...prev, [key]: !prev[key] }));

  const fileCount = previewFiles?.length ?? 0;
  const continueDisabled =
    (step === 0 && repo.trim() === "") ||
    (step === 1 && (previewLoading || !previewFiles)) ||
    (step === 2 && noTriggersSelected(triggers));

  return (
    <Modal
      width={820}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <div>
            {step > 0 && !installResult && (
              <Button kind="ghost" onClick={() => (step === 2 ? enterPreview() : setStep(step - 1))}>
                {t("exportWizard.back")}
              </Button>
            )}
          </div>
          <div style={s.footerRight}>
            {step < 3 ? (
              <Button
                kind="primary"
                disabled={continueDisabled}
                loading={step === 0 && previewLoading}
                onClick={() => (step === 0 ? enterPreview() : setStep(step + 1))}
              >
                {t("exportWizard.continue")}
              </Button>
            ) : installResult ? (
              <Button kind="primary" onClick={onClose}>
                {t("exportWizard.done")}
              </Button>
            ) : (
              <Button kind="primary" disabled={exportCi.isPending} loading={exportCi.isPending} onClick={handleInstall}>
                {exportCi.isPending ? t("exportWizard.installing") : t("exportWizard.install")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.stepsRow}>
          <ExportWizardSteps step={step} labels={WIZARD_STEP_KEYS.map((key) => t(`exportWizard.steps.${key}`))} />
        </div>

        {step === 0 && <TargetStep repo={repo} onRepoChange={setRepo} />}
        {step === 1 && (
          <PreviewStep
            files={previewFiles}
            loading={previewLoading}
            selectedPath={selectedFilePath}
            onSelectPath={setSelectedFilePath}
            editedContents={editedContents}
            onEditContent={(path, value) => setEditedContents((prev) => ({ ...prev, [path]: value }))}
          />
        )}
        {step === 2 && (
          <ConfigureStep
            triggers={triggers}
            onToggleTrigger={toggleTrigger}
            postAs={postAs}
            onPostAsChange={setPostAs}
          />
        )}
        {step === 3 && (
          <InstallStep
            repo={repo}
            fileCount={fileCount}
            installMethod={installMethod}
            onInstallMethodChange={setInstallMethod}
            result={installResult}
          />
        )}

        {errorMessage && (
          <div style={s.errorNote}>
            <Icon.AlertTriangle size={13} />
            {errorMessage}
          </div>
        )}
      </div>
    </Modal>
  );
}
