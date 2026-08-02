"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, Textarea, Tabs, Badge } from "@devdigest/ui";
import type { EvalCase } from "@devdigest/shared";
import { useCreateEvalCase, useUpdateEvalCase, useRunEvalCase } from "../../../../../../../../../lib/hooks/evals";
import { isValidJson } from "./helpers";
import { s } from "./styles";

/** Create/edit an eval case for this agent: name + input (diff or PR
 *  title/body) on the left, expected-output JSON on the right. Can also
 *  trigger a run for an existing case and show its last result. */
export function EvalCaseModal({
  agentId,
  existing,
  onClose,
}: {
  agentId: string;
  existing?: EvalCase;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const create = useCreateEvalCase(agentId);
  const update = useUpdateEvalCase(agentId);
  const run = useRunEvalCase(agentId);

  const meta = (existing?.input_meta ?? {}) as { title?: string; body?: string };
  const [name, setName] = React.useState(existing?.name ?? "");
  const [tab, setTab] = React.useState("diff");
  const [diff, setDiff] = React.useState(existing?.input_diff ?? "");
  const [title, setTitle] = React.useState(meta.title ?? "");
  const [body, setBody] = React.useState(meta.body ?? "");
  const [expectedText, setExpectedText] = React.useState(
    existing?.expected_output ? JSON.stringify(existing.expected_output, null, 2) : "[]",
  );

  const jsonValid = isValidJson(expectedText);
  const saving = create.isPending || update.isPending;

  const save = async () => {
    const input = {
      name,
      input_diff: diff,
      input_meta: { title, body },
      expected_output: jsonValid && expectedText.trim() ? JSON.parse(expectedText) : [],
    };
    if (existing) await update.mutateAsync({ id: existing.id, patch: input });
    else await create.mutateAsync(input);
    onClose();
  };

  return (
    <Modal
      width={900}
      title={t("caseEditor.caseTitle", { name: name || t("caseEditor.newCase") })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {existing && (
            <Button
              kind="secondary"
              icon="Play"
              onClick={() => run.mutate(existing.id)}
              disabled={run.isPending}
            >
              {run.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <Button kind="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="primary" onClick={save} disabled={saving || !name.trim() || !jsonValid}>
              {saving ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.columns}>
        <div style={{ flex: 1 }}>
          <FormField label={t("caseEditor.nameLabel")} required>
            <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
          </FormField>
          <Tabs
            tabs={[
              { key: "diff", label: t("caseEditor.tabs.diff") },
              { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "diff" ? (
            <Textarea value={diff} onChange={setDiff} rows={16} mono placeholder={t("caseEditor.diffPlaceholder")} />
          ) : (
            <>
              <FormField label={t("caseEditor.titleLabel")}>
                <TextInput value={title} onChange={setTitle} placeholder={t("caseEditor.titlePlaceholder")} />
              </FormField>
              <FormField label={t("caseEditor.bodyLabel")}>
                <Textarea value={body} onChange={setBody} rows={6} placeholder={t("caseEditor.bodyPlaceholder")} />
              </FormField>
            </>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <FormField
            label={t("caseEditor.expectedOutput")}
            right={<Badge color={jsonValid ? "var(--ok)" : "var(--crit)"}>{jsonValid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}</Badge>}
          >
            <Textarea value={expectedText} onChange={setExpectedText} rows={16} mono />
          </FormField>
          {existing && run.data && (
            <Badge color={run.data.run.per_trace[0]?.pass ? "var(--ok)" : "var(--crit)"}>
              {run.data.run.per_trace[0]?.pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
            </Badge>
          )}
        </div>
      </div>
    </Modal>
  );
}
