"use client";

import React from "react";
import { Icon, SectionLabel, Badge, MonoLink } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { githubBlobUrl } from "@/lib/github-urls";
import type { BlastDegradedReason } from "@devdigest/shared";
import { BlastGraphModal } from "./BlastGraphModal";
import { s, chevronFor } from "./styles";

interface BlastRadiusCardProps {
  prId: string | null | undefined;
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
 * Compact Blast Radius card for the Overview tab (mockup: header counts +
 * Tree/Graph toggle, one collapsible row per changed symbol with its callers
 * and endpoint/cron chips inline — no separate "Callers"/"Endpoints"
 * subheaders, unlike the full BlastTab page). Shares `useBlastRadius` with
 * BlastTab — same TanStack Query key, so this never issues a second network
 * request when both are mounted.
 *
 * "Graph" opens a full-screen force-directed node/edge view
 * (`BlastGraphModal`) over the same already-fetched data — no new fetch.
 * There is no backing data for the mockup's "Prior PRs touching these files"
 * row (that's PR-history, a separate/later feature with no server support
 * yet) so it's intentionally omitted rather than faked.
 */
export function BlastRadiusCard({ prId, repoFullName, headSha }: BlastRadiusCardProps) {
  const { data: blast, isLoading, isError } = useBlastRadius(prId);
  const [openIndex, setOpenIndex] = React.useState<number | null>(0);
  const [showGraph, setShowGraph] = React.useState(false);

  if (isLoading) return null;
  if (isError || !blast) return null;

  const symbolCount = blast.changed_symbols.length;
  const callerCount = blast.downstream.reduce((sum, d) => sum + d.callers.length, 0);
  const endpointCount = new Set(blast.downstream.flatMap((d) => d.endpoints_affected)).size;
  const cronCount = new Set(blast.downstream.flatMap((d) => d.crons_affected)).size;

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <div style={s.headerRight}>
            <span style={s.countItem}>
              <Icon.Code size={12} /> {symbolCount} {symbolCount === 1 ? "symbol" : "symbols"}
            </span>
            <span style={s.countItem}>
              <Icon.CornerDownRight size={12} /> {callerCount} {callerCount === 1 ? "caller" : "callers"}
            </span>
            <span style={s.countItem}>
              <Icon.Globe size={12} /> {endpointCount} {endpointCount === 1 ? "endpoint" : "endpoints"}
            </span>
            {cronCount > 0 && (
              <span style={s.countItem}>
                <Icon.Clock size={12} /> {cronCount} {cronCount === 1 ? "cron" : "crons"}
              </span>
            )}
            <div style={s.viewToggle}>
              <button type="button" style={{ ...s.viewToggleBtn, ...s.viewToggleBtnActive }} disabled>
                Tree
              </button>
              <button
                type="button"
                style={s.viewToggleBtn}
                onClick={() => setShowGraph(true)}
              >
                Graph
              </button>
            </div>
          </div>
        }
      >
        Blast radius
      </SectionLabel>

      <div style={s.card}>
        {blast.degraded && (
          <div style={s.banner}>
            <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>{blast.reason ? DEGRADED_MESSAGE[blast.reason] : "This result may be incomplete."}</span>
          </div>
        )}

        {blast.downstream.length === 0 ? (
          <div style={s.empty}>
            No downstream callers found for this PR's changed symbols
            {blast.degraded ? " — the index is incomplete, so this may be undercounted." : "."}
          </div>
        ) : (
          <div style={s.body}>
            {blast.downstream.map((impact, i) => {
              const open = openIndex === i;
              const hasChips = impact.endpoints_affected.length > 0 || impact.crons_affected.length > 0;
              return (
                <div key={impact.symbol} style={s.group}>
                  <div
                    style={s.groupHeader}
                    onClick={() => setOpenIndex(open ? null : i)}
                    role="button"
                    aria-expanded={open}
                  >
                    <Icon.ChevronRight size={13} style={chevronFor(open)} />
                    <Icon.Code size={13} style={{ color: "var(--text-muted)" }} />
                    <span className="mono" style={s.groupTitle}>
                      {impact.symbol}()
                    </span>
                    <span style={s.groupCount}>
                      {impact.callers.length} {impact.callers.length === 1 ? "caller" : "callers"}
                    </span>
                  </div>
                  {open && (
                    <div style={s.groupBody}>
                      {impact.callers.length === 0 ? (
                        <div style={s.callerRow}>No callers found in the index.</div>
                      ) : (
                        impact.callers.map((caller, ci) => {
                          const href =
                            repoFullName && headSha
                              ? githubBlobUrl(repoFullName, headSha, caller.file, caller.line)
                              : undefined;
                          return (
                            <div key={`${caller.file}:${caller.line}:${ci}`} style={s.callerRow}>
                              <Icon.CornerDownRight
                                size={12}
                                style={{ color: "var(--text-muted)", flexShrink: 0 }}
                              />
                              <MonoLink href={href}>
                                {caller.file}:{caller.line}
                              </MonoLink>
                            </div>
                          );
                        })
                      )}
                      {hasChips && (
                        <div style={s.chipRow}>
                          {impact.endpoints_affected.map((endpoint) => (
                            <Badge key={endpoint} icon="Globe" color="var(--info)" bg="var(--info-bg)" mono>
                              {endpoint}
                            </Badge>
                          ))}
                          {impact.crons_affected.map((cron) => (
                            <Badge key={cron} icon="Clock" color="var(--warn)" bg="var(--warn-bg)" mono>
                              {cron}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showGraph && <BlastGraphModal blast={blast} onClose={() => setShowGraph(false)} />}
    </section>
  );
}
