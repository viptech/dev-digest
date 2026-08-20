"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, Textarea, Tabs, Badge, Toggle } from "@devdigest/ui";
import type { EvalCaseDraft, EvalCaseWithLastRun } from "@/lib/hooks/evals";
import { useCreateEvalCase, useUpdateEvalCase, useRunEvalCase } from "@/lib/hooks/evals";
import { ApiError } from "@/lib/api";
import { isValidJson, appendSkeletonExpectation, parseDiffFilePaths, deriveExpectationSummary } from "./helpers";
import { s } from "./styles";

/** Create/edit an eval case for this owner: name + input (diff or PR
 *  title/body/files) on the left, expected-output JSON on the right. Can
 *  also trigger a run for an existing case and show its last result.
 *
 *  Promoted to the shared components layer (SPEC-05 T13) — it now has two
 *  callers: `EvalsTab`/`EvalOwnerTab` (agents/skills features,
 *  edit/create-new) and `FindingsPanel` (repos/pulls feature, "Turn into
 *  eval case" seeded drafts, always agent-owned).
 *
 *  `ownerKind` (SPEC-06 AC-21, Development Plan `skill-editor.md` Step 5):
 *  inspection during that step found the hooks this component calls
 *  (`useCreateEvalCase`/`useUpdateEvalCase`/`useRunEvalCase`) were
 *  generalized to require `{ ownerKind, ownerId }` — so this modal needs a
 *  minimal, additive `ownerKind` prop (defaulting to `"agent"`) to keep
 *  routing to the right base path for a skill-owned case; `agentId` doubles
 *  as the generic owner id and keeps its existing name so the two
 *  already-agent-only callers (`FindingsPanel`, its own test file) need no
 *  changes.
 *
 *  Seeded mode (`draft`/`seededFrom` set): the finding→eval-case button
 *  builds an UNSAVED draft server-side and opens it here for review before
 *  persisting — Save/Run case (existing `useCreateEvalCase`/`useRunEvalCase`
 *  paths) is still the only way it's ever written to `eval_cases`. */
export function EvalCaseModal({
  agentId,
  ownerKind = "agent",
  existing,
  draft,
  seededFrom,
  onClose,
}: {
  agentId: string;
  /** `'skill'` for a skill-owned case (SPEC-06); defaults to `'agent'` so
   *  existing callers (agents' EvalsTab, FindingsPanel) need no change. */
  ownerKind?: "agent" | "skill";
  existing?: EvalCaseWithLastRun;
  /** An unsaved draft from `POST /findings/:id/eval-case` (SPEC-05 T13) —
   *  pre-fills the form but, unlike `existing`, has no persisted `id`: Save
   *  always creates (never updates) when only `draft` is given. */
  draft?: EvalCaseDraft;
  /** Set when this modal was opened from a FindingCard's "Turn into eval
   *  case" button — drives the seeded-mode subtitle. */
  seededFrom?: "accepted" | "dismissed";
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const owner = { ownerKind, ownerId: agentId };
  const create = useCreateEvalCase(owner);
  const update = useUpdateEvalCase(owner);
  const run = useRunEvalCase(owner);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const [runOnSave, setRunOnSave] = React.useState(false);

  const seed = existing ?? draft;
  const meta = (seed?.input_meta ?? {}) as { title?: string; body?: string };
  const [name, setName] = React.useState(seed?.name ?? "");
  const [tab, setTab] = React.useState("diff");
  const [diff, setDiff] = React.useState(seed?.input_diff ?? "");
  const [title, setTitle] = React.useState(meta.title ?? "");
  const [body, setBody] = React.useState(meta.body ?? "");
  const [expectedText, setExpectedText] = React.useState(
    seed?.expected_output ? JSON.stringify(seed.expected_output, null, 2) : "[]",
  );

  const jsonValid = isValidJson(expectedText);
  const saving = create.isPending || update.isPending;

  const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

  const buildInput = () => ({
    name,
    input_diff: diff,
    input_meta: { title, body },
    expected_output: jsonValid && expectedText.trim() ? JSON.parse(expectedText) : [],
  });

  /** Create-or-update, returning the persisted case id — used both by the
   *  plain Save button and by "Run case" (which must save first so the run
   *  reflects unsaved edits, not the stale persisted row). A `draft` (no
   *  `id`) always creates, same as a brand-new case. */
  const persist = async (): Promise<string> => {
    const input = buildInput();
    if (existing) {
      const updated = await update.mutateAsync({ id: existing.id, patch: input });
      return updated.id;
    }
    const created = await create.mutateAsync(input);
    return created.id;
  };

  const save = async () => {
    setError(null);
    try {
      await persist();
      onClose();
    } catch (e) {
      setError(errorMessage(e, t("caseEditor.saveFailed")));
    }
  };

  const saveAndRun = async () => {
    setError(null);
    setRunning(true);
    try {
      const caseId = await persist();
      await run.mutateAsync(caseId);
    } catch (e) {
      setError(errorMessage(e, t("caseEditor.runFailed")));
    } finally {
      setRunning(false);
    }
  };

  const onSaveClick = runOnSave ? saveAndRun : save;
  const onFindingSkeleton = () => setExpectedText((current) => appendSkeletonExpectation(current));

  const freshRun = run.data?.run;
  const summary = React.useMemo(() => deriveExpectationSummary(expectedText, title), [expectedText, title]);
  const filePaths = React.useMemo(() => parseDiffFilePaths(diff), [diff]);

  return (
    <Modal
      width={900}
      title={existing ? t("caseEditor.caseTitle", { name }) : t("caseEditor.newCase")}
      subtitle={seededFrom ? t("caseEditor.seededSubtitle", { decision: seededFrom }) : undefined}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <div style={s.errorNotice}>{error}</div>}
          <div style={s.footer}>
            <div style={s.runOnSaveRow}>
              {t("caseEditor.runOnSave")}
              <Toggle on={runOnSave} onChange={setRunOnSave} size={14} />
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              <Button kind="ghost" onClick={onClose}>
                {t("caseEditor.cancel")}
              </Button>
              <Button
                kind="secondary"
                icon="Play"
                onClick={saveAndRun}
                disabled={running || saving || !name.trim() || !jsonValid}
              >
                {running ? t("caseEditor.running") : t("caseEditor.runCase")}
              </Button>
              <Button kind="primary" onClick={onSaveClick} disabled={saving || running || !name.trim() || !jsonValid}>
                {saving ? t("caseEditor.saving") : t("caseEditor.save")}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.columns}>
        <div style={{ flex: 1 }}>
          {summary && (
            <div style={s.summaryCard(summary.kind)}>
              <div style={s.summaryCardLabel(summary.kind)}>
                {summary.kind === "must_find" ? t("caseEditor.positiveCase") : t("caseEditor.negativeCase")}
              </div>
              <div style={s.summaryCardText}>{summary.text}</div>
            </div>
          )}
          <FormField label={t("caseEditor.nameLabel")} required>
            <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
          </FormField>
          <Tabs
            tabs={[
              { key: "diff", label: t("caseEditor.tabs.diff") },
              { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
              { key: "files", label: t("caseEditor.tabs.files") },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "diff" && (
            <Textarea value={diff} onChange={setDiff} rows={16} mono placeholder={t("caseEditor.diffPlaceholder")} />
          )}
          {tab === "prMeta" && (
            <>
              <FormField label={t("caseEditor.titleLabel")}>
                <TextInput value={title} onChange={setTitle} placeholder={t("caseEditor.titlePlaceholder")} />
              </FormField>
              <FormField label={t("caseEditor.bodyLabel")}>
                <Textarea value={body} onChange={setBody} rows={6} placeholder={t("caseEditor.bodyPlaceholder")} />
              </FormField>
            </>
          )}
          {tab === "files" && (
            <div style={s.filesList}>
              {filePaths.length === 0
                ? t("caseEditor.filesEmpty")
                : filePaths.map((p) => <div key={p}>{p}</div>)}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <FormField
            label={t("caseEditor.expectedOutput")}
            right={
              <div style={s.expectedHeaderRight}>
                <Badge color={jsonValid ? "var(--ok)" : "var(--crit)"}>
                  {jsonValid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
                </Badge>
                <Button kind="ghost" size="sm" onClick={onFindingSkeleton}>
                  {t("caseEditor.findingSkeleton")}
                </Button>
              </div>
            }
          >
            <Textarea value={expectedText} onChange={setExpectedText} rows={16} mono />
          </FormField>

          <div style={s.actualOutputWrap}>
            <FormField label={t("caseEditor.actualOutput")}>
              {freshRun?.per_trace[0] ? (
                <pre style={s.actualOutputPre}>{JSON.stringify(freshRun.per_trace[0]!.actual, null, 2)}</pre>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("caseEditor.actualOutputEmpty")}</div>
              )}
            </FormField>
          </div>
        </div>
      </div>

        {freshRun ? (
          <div style={s.runBanner(freshRun.traces_passed === freshRun.traces_total && freshRun.traces_total > 0)}>
            {freshRun.traces_passed === freshRun.traces_total && freshRun.traces_total > 0
              ? t("caseEditor.lastRunPassed")
              : t("caseEditor.lastRunFailed")}
            {" · "}
            {t("caseEditor.tracesSummary", { passed: freshRun.traces_passed, total: freshRun.traces_total })}
            {" · "}
            {(freshRun.duration_ms / 1000).toFixed(1)}s{" · "}${(freshRun.cost_usd ?? 0).toFixed(2)}
          </div>
        ) : (
          existing?.last_run && (
            <div style={s.runBanner(existing.last_run.pass)}>
              {existing.last_run.pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
