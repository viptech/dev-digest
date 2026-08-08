"use client";

import React from "react";
import { Icon, SectionLabel, MonoLink } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { githubBlobUrl } from "@/lib/github-urls";
import type { BlastDegradedReason, DownstreamImpact } from "@devdigest/shared";
import { s, chevronFor } from "./styles";

interface BlastTabProps {
  prId: string | null;
  /** owner/repo — null until the repo is loaded (see PrDetailHeader's same
   *  prop for the identical reason: it gates the GitHub deep-link). */
  repoFullName: string | null;
  headSha: string | null;
}

const DEGRADED_MESSAGE: Record<BlastDegradedReason, string> = {
  flag_off: "Repo intelligence indexing is disabled for this repo.",
  index_failed: "The code index failed to build — blast radius may be incomplete.",
  index_partial: "Index is partial — some callers/endpoints may be missing.",
  repo_too_large: "This repo is too large for a full index — results may be incomplete.",
  no_data: "No index data yet for this repo — blast radius could not be computed.",
};

/**
 * Blast Radius — which symbols this PR's changed files declared, who
 * calls/imports them, and which HTTP endpoints/crons might be affected.
 * Computed server-side from the persistent repo-intel index (no LLM call).
 *
 * A 3-level collapsible list (symbol -> callers -> endpoints), copying
 * SmartDiffViewer's exact collapsible-group interaction/styling
 * (chevronFor / groupHeader / groupBody) rather than a generic tree
 * component — 3 fixed levels don't justify that abstraction.
 *
 * Every file:line renders via the external GitHub blob link (MonoLink +
 * githubBlobUrl), never an in-app scroll — see the plan's rationale: the
 * diff tab only renders patch hunks, and a blast-radius caller's line is
 * almost always outside the PR's diff.
 */
export function BlastTab({ prId, repoFullName, headSha }: BlastTabProps) {
  const { data: blast, isLoading, isError } = useBlastRadius(prId);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [subExpanded, setSubExpanded] = React.useState<Record<string, boolean>>({});

  const isOpen = (key: string) => expanded[key] ?? true;
  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !isOpen(key) }));
  const isSubOpen = (key: string) => subExpanded[key] ?? true;
  const toggleSub = (key: string) => setSubExpanded((prev) => ({ ...prev, [key]: !isSubOpen(key) }));

  if (isLoading) return <div style={s.empty}>Loading blast radius…</div>;
  if (isError || !blast) return <div style={s.empty}>Couldn't load blast radius.</div>;

  const changedSymbolByName = new Map(blast.changed_symbols.map((sym) => [sym.name, sym]));

  return (
    <section>
      <SectionLabel icon="Target">Blast radius</SectionLabel>
      <div style={s.wrap}>
        {blast.degraded && (
          <div style={s.banner}>
            <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>{blast.reason ? DEGRADED_MESSAGE[blast.reason] : "This result may be incomplete."}</span>
          </div>
        )}

        <div style={s.summary}>{blast.summary}</div>

        {blast.downstream.length === 0 ? (
          <div style={s.empty}>
            No downstream callers found for this PR's changed symbols
            {blast.degraded ? " — the index is incomplete, so this may be undercounted." : "."}
          </div>
        ) : (
          blast.downstream.map((impact) => {
            const declSymbol = changedSymbolByName.get(impact.symbol);
            const open = isOpen(impact.symbol);
            const hasEndpoints = impact.endpoints_affected.length > 0 || impact.crons_affected.length > 0;
            return (
              <div key={impact.symbol} style={s.group}>
                <div
                  style={s.groupHeader}
                  onClick={() => toggle(impact.symbol)}
                  role="button"
                  aria-expanded={open}
                >
                  <Icon.ChevronRight size={13} style={chevronFor(open)} />
                  <Icon.Zap size={15} style={{ color: "var(--text-muted)" }} />
                  <div style={s.groupTitleWrap}>
                    <span style={s.groupTitle}>
                      {impact.symbol} · {impact.callers.length}{" "}
                      {impact.callers.length === 1 ? "caller" : "callers"}
                    </span>
                    {declSymbol && (
                      <span style={s.groupDescription}>
                        {declSymbol.kind} · {declSymbol.file}
                      </span>
                    )}
                  </div>
                </div>
                {open && (
                  <div style={s.groupBody}>
                    <CallersSubgroup
                      impact={impact}
                      open={isSubOpen(`${impact.symbol}:callers`)}
                      onToggle={() => toggleSub(`${impact.symbol}:callers`)}
                      repoFullName={repoFullName}
                      headSha={headSha}
                    />
                    {hasEndpoints && (
                      <EndpointsSubgroup
                        impact={impact}
                        open={isSubOpen(`${impact.symbol}:endpoints`)}
                        onToggle={() => toggleSub(`${impact.symbol}:endpoints`)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/** Level 2/3 — callers of one changed symbol, each a file:line GitHub link. */
function CallersSubgroup({
  impact,
  open,
  onToggle,
  repoFullName,
  headSha,
}: {
  impact: DownstreamImpact;
  open: boolean;
  onToggle: () => void;
  repoFullName: string | null;
  headSha: string | null;
}) {
  return (
    <div style={s.subGroup}>
      <div style={s.subGroupHeader} onClick={onToggle} role="button" aria-expanded={open}>
        <Icon.ChevronRight size={12} style={chevronFor(open)} />
        <Icon.Users size={13} style={{ color: "var(--text-muted)" }} />
        <span>Callers ({impact.callers.length})</span>
      </div>
      {open && (
        <div style={s.subGroupBody}>
          {impact.callers.length === 0 ? (
            <div style={s.row}>No callers found in the index.</div>
          ) : (
            impact.callers.map((caller, i) => {
              const href =
                repoFullName && headSha
                  ? githubBlobUrl(repoFullName, headSha, caller.file, caller.line)
                  : undefined;
              return (
                <div key={`${caller.file}:${caller.line}:${i}`} style={s.row}>
                  <Icon.CornerDownRight size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <span>{caller.name}</span>
                  <MonoLink href={href}>
                    {caller.file}:{caller.line}
                  </MonoLink>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/** Level 2/3 — HTTP endpoints/crons potentially affected by one changed symbol. */
function EndpointsSubgroup({
  impact,
  open,
  onToggle,
}: {
  impact: DownstreamImpact;
  open: boolean;
  onToggle: () => void;
}) {
  const total = impact.endpoints_affected.length + impact.crons_affected.length;
  return (
    <div style={s.subGroup}>
      <div style={s.subGroupHeader} onClick={onToggle} role="button" aria-expanded={open}>
        <Icon.ChevronRight size={12} style={chevronFor(open)} />
        <Icon.Globe size={13} style={{ color: "var(--text-muted)" }} />
        <span>Endpoints &amp; crons affected ({total})</span>
      </div>
      {open && (
        <div style={s.subGroupBody}>
          {impact.endpoints_affected.map((endpoint) => (
            <div key={endpoint} style={s.row}>
              <Icon.Globe size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span className="mono">{endpoint}</span>
            </div>
          ))}
          {impact.crons_affected.map((cron) => (
            <div key={cron} style={s.row}>
              <Icon.Clock size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span className="mono">{cron}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
