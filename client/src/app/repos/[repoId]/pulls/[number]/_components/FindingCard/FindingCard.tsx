/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { useCreateEvalCaseFromFinding, type EvalCaseDraft } from "@/lib/hooks/evals";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/toast";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  forceFocus,
  focusNonce,
  onAction,
  pending,
  repoFullName,
  headSha,
  onOpenEvalCaseDraft,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  /** True when an external jump (e.g. a Smart Diff finding badge) targets
   *  this exact card — expands it and scrolls it into view. */
  forceFocus?: boolean;
  /** Bumped on every jump so the effect re-fires even when `forceFocus` was
   *  already true (re-clicking the same badge). */
  focusNonce?: number;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** SPEC-05 T13 — "Turn into eval case" fetches an unsaved draft, then
   *  bubbles it up so the nearest common ancestor of every FindingCard
   *  (`FindingsPanel`) can open the shared `EvalCaseModal` with it. Only one
   *  card's draft can be open at a time, hence the modal itself is NOT
   *  rendered here. */
  onOpenEvalCaseDraft?: (draft: EvalCaseDraft, seededFrom: "accepted" | "dismissed") => void;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (forceFocus) {
      setExpanded(true);
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceFocus, focusNonce]);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  const hasDecision = accepted || dismissed;
  const createEvalCase = useCreateEvalCaseFromFinding();

  const onTurnIntoEvalCase = async () => {
    try {
      const draft = await createEvalCase.mutateAsync(f.id);
      // SPEC-05 T13 (corrected AC-1/AC-4): open the existing EvalCaseModal
      // pre-filled and UNSAVED, rather than persisting immediately — the
      // caller (FindingsPanel) owns rendering the modal itself.
      onOpenEvalCaseDraft?.(draft, accepted ? "accepted" : "dismissed");
    } catch (e) {
      notify.error(e instanceof ApiError ? e.message : t("finding.evalCaseCreateFailed"));
    }
  };

  return (
    <div ref={cardRef} data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={!hasDecision || createEvalCase.isPending}
              onClick={onTurnIntoEvalCase}
            >
              {t("finding.turnIntoEvalCase")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
