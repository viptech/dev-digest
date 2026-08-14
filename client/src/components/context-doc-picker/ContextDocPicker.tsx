"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Modal } from "@devdigest/ui";
import { Badge, IconBtn, Markdown, EmptyState } from "@devdigest/ui";
import type { ProjectContextCategory, ProjectContextDoc } from "@devdigest/shared";
import { useActiveRepo } from "../../lib/repo-context";
import {
  useRepoContextDocs,
  useContextDocContent,
  useContextDocsCharsMap,
  approxTokens,
  CLIENT_CONTEXT_BUDGET_CHARS_WARNING,
} from "../../lib/hooks/project-context";
import { reorder, distinctRepoIds, categorizePathForDisplay } from "./helpers";
import { s } from "./styles";

/** One attached document — the shape `AgentContextDocLink`/`SkillContextDocLink`
 *  both already have (owner/name joined in for display). Structurally
 *  compatible with either, so callers pass their query data straight through. */
export interface AttachedContextDoc {
  repo_id: string;
  path: string;
  order: number;
  owner: string;
  name: string;
}

const CATEGORY_COLOR: Record<ProjectContextCategory, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
  other: "var(--text-muted)",
};

/**
 * Shared "Project context" attach UI (SPEC-01) — used by the Agent editor's
 * Context tab (AC-4, AC-5, AC-6) AND the Skill drawer's "Project context to
 * use" section (AC-7) from day one (react-ui-architecture: promote on the
 * second user, not speculatively — this genuinely has two callers at once).
 *
 * (a) an always-visible, cross-repo ordered "currently attached" list (one
 *     shared drag list spanning every repo a doc came from), and
 * (b) a discovery table for the app's already-active repo (the same one
 *     the sidebar's workspace switcher already established via
 *     `useActiveRepo()`), with attach checkboxes + category badge +
 *     Preview. Deliberately NO separate repo-selector here — the user
 *     pointed out this would just duplicate a choice the app already makes
 *     elsewhere; to attach from a different repo, switch the app's active
 *     repo first, then come back. Applies identically to both callers
 *     (Agent editor's Context tab and the Skill drawer's "Project context
 *     to use" section) since they share this one component.
 *
 * `onSetDocs` always receives the FULL ordered set (index = order) —
 * matches `ProjectContextRepository.setAgentDocs`/`setSkillDocs`'s
 * replace-whole-set semantics, same convention as `useSetAgentSkills`.
 */
export function ContextDocPicker({
  attachedDocs,
  onSetDocs,
  isSaving,
}: {
  attachedDocs: AttachedContextDoc[];
  onSetDocs: (docs: { repo_id: string; path: string }[]) => void;
  isSaving?: boolean;
}) {
  const t = useTranslations("projectContext");
  const { activeRepo } = useActiveRepo();
  const attached = React.useMemo(
    () => attachedDocs.slice().sort((a, b) => a.order - b.order),
    [attachedDocs],
  );

  // The discovery table always follows the app's already-active repo (the
  // sidebar's workspace switcher) — no separate repo-selector here, which
  // would just duplicate that choice. Falls back to an already-attached
  // doc's repo only if, somehow, no repo is active yet.
  const effectiveRepoId = activeRepo?.id ?? attached[0]?.repo_id ?? null;

  const { data: discovered } = useRepoContextDocs(effectiveRepoId);
  const [dragIdx, setDragIdx] = React.useState<number | null>(null);
  const [preview, setPreview] = React.useState<{ repoId: string; path: string } | null>(null);

  const attachedKeys = new Set(attached.map((d) => `${d.repo_id}:${d.path}`));
  const usageByPath = new Map((discovered ?? []).map((d) => [d.path, d.used_by_agents]));

  const charsMap = useContextDocsCharsMap(
    distinctRepoIds([...attached.map((d) => d.repo_id), effectiveRepoId]),
  );
  const totalChars = attached.reduce(
    (sum, d) => sum + (charsMap.get(`${d.repo_id}:${d.path}`) ?? 0),
    0,
  );
  const overBudget = totalChars > CLIENT_CONTEXT_BUDGET_CHARS_WARNING;

  function emit(next: AttachedContextDoc[]) {
    onSetDocs(next.map((d) => ({ repo_id: d.repo_id, path: d.path })));
  }

  function toggle(doc: ProjectContextDoc, on: boolean) {
    if (!effectiveRepoId) return;
    if (on) {
      // `owner`/`name` are display-only placeholders here — `emit()` strips
      // them immediately (the server response, once the mutation resolves,
      // is what actually re-renders the attached list with real values).
      emit([
        ...attached,
        { repo_id: effectiveRepoId, path: doc.path, order: attached.length, owner: "", name: "" },
      ]);
    } else {
      emit(attached.filter((d) => !(d.repo_id === effectiveRepoId && d.path === doc.path)));
    }
  }

  function detach(idx: number) {
    emit(attached.filter((_, i) => i !== idx));
  }

  function onDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) return;
    emit(reorder(attached, dragIdx, targetIdx));
    setDragIdx(null);
  }

  return (
    <div style={s.wrap}>
      <div>
        <div style={s.headerRow}>
          <span style={s.sectionLabel}>{t("attachedTitle")}</span>
          <Badge>{t("attachedBadge", { n: attached.length })}</Badge>
          <span style={{ marginLeft: "auto", ...s.budget(overBudget) }}>
            {t("tokenEstimate", { tokens: approxTokens(totalChars) })}
            {overBudget ? ` — ${t("budgetWarning")}` : ""}
          </span>
        </div>
        <p style={s.hint}>{t("orderHint")}</p>
        {attached.length === 0 && (
          <p style={s.hint}>{t("noneAttached")}</p>
        )}
        {attached.map((doc, idx) => {
          const category = categorizePathForDisplay(doc.path);
          return (
          <div
            key={`${doc.repo_id}:${doc.path}`}
            style={s.row}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(idx)}
          >
            <IconBtn icon="Menu" label={t("reorderHandle")} size={24} />
            <span style={s.path}>{doc.path}</span>
            {category && <Badge color={CATEGORY_COLOR[category]}>{category}</Badge>}
            <span style={s.repoTag}>{doc.owner}/{doc.name}</span>
            <IconBtn
              icon="Eye"
              label={t("preview")}
              size={26}
              onClick={() => setPreview({ repoId: doc.repo_id, path: doc.path })}
            />
            <IconBtn icon="X" label={t("detach")} size={26} onClick={() => detach(idx)} />
          </div>
          );
        })}
      </div>

      <div>
        <div style={s.discoveryHeaderRow}>
          <span style={s.sectionLabel}>{t("discoverTitle")}</span>
          {/* Plain text, not a selector — this is the app's already-active
              repo (sidebar workspace switcher), not a choice made here. */}
          {activeRepo && <span style={s.repoTag}>{activeRepo.full_name}</span>}
          {discovered && (
            <Badge>
              {t("nOfMAttached", {
                n: attached.filter((d) => d.repo_id === effectiveRepoId).length,
                m: discovered.length,
              })}
            </Badge>
          )}
        </div>
        {!discovered || discovered.length === 0 ? (
          <EmptyState title={t("emptyDiscoveryTitle")} body={t("emptyDiscoveryBody")} />
        ) : (
          discovered.map((doc) => {
            const isAttached = attachedKeys.has(`${effectiveRepoId}:${doc.path}`);
            return (
              <div key={doc.path} style={s.row}>
                <Checkbox checked={isAttached} onChange={(on) => (isSaving ? undefined : toggle(doc, on))} />
                <span style={s.path}>{doc.path}</span>
                <Badge color={CATEGORY_COLOR[doc.category]}>{doc.category}</Badge>
                <span style={s.repoTag}>{t("usedBy", { n: usageByPath.get(doc.path) ?? 0 })}</span>
                <IconBtn
                  icon="Eye"
                  label={t("preview")}
                  size={26}
                  onClick={() => effectiveRepoId && setPreview({ repoId: effectiveRepoId, path: doc.path })}
                />
              </div>
            );
          })
        )}
      </div>

      {preview && <PreviewModal repoId={preview.repoId} path={preview.path} onClose={() => setPreview(null)} />}
    </div>
  );
}

function PreviewModal({
  repoId,
  path,
  onClose,
}: {
  repoId: string;
  path: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useContextDocContent(repoId, path);
  return (
    <Modal title={path} onClose={onClose} width={760}>
      {isLoading ? null : <Markdown>{data?.content ?? ""}</Markdown>}
    </Modal>
  );
}
