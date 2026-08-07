"use client";

import React from "react";
import { IconBtn } from "@devdigest/ui";
import type { BlastRadius } from "@devdigest/shared";
import { buildGraphData, computeForceLayout, type GraphNodeRole } from "./graph";

const ROLE_COLOR: Record<GraphNodeRole, string> = {
  changed_symbol: "var(--accent)",
  caller: "var(--text-muted)",
  endpoint: "var(--ok)",
};

const ROLE_LABEL: Record<GraphNodeRole, string> = {
  changed_symbol: "Changed symbol",
  caller: "Caller",
  endpoint: "Endpoint",
};

const NODE_RADIUS: Record<GraphNodeRole, number> = {
  changed_symbol: 12,
  caller: 6,
  endpoint: 6,
};

/**
 * Full-screen "Graph" view for Blast Radius — a force-directed node/edge
 * diagram (changed symbols → their callers/endpoints), as an alternative to
 * the collapsible Tree list. Pure client-side rendering of data the Tree
 * view already has (`BlastRadius`); no new fetch.
 */
export function BlastGraphModal({ blast, onClose }: { blast: BlastRadius; onClose: () => void }) {
  const width = 1600;
  const height = 900;

  const laidOut = React.useMemo(() => {
    const { nodes, edges } = buildGraphData(blast);
    return { nodes: computeForceLayout(nodes, edges, width, height), edges };
  }, [blast]);

  const nodeById = new Map(laidOut.nodes.map((n) => [n.id, n]));

  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label="Blast radius graph">
      <div style={s.closeBtn}>
        <IconBtn icon="X" label="Close" onClick={onClose} />
      </div>
      {laidOut.nodes.length === 0 ? (
        <div style={s.empty}>No downstream callers or endpoints to graph.</div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} style={s.svg} preserveAspectRatio="xMidYMid meet">
          {laidOut.edges.map((e, i) => {
            const a = nodeById.get(e.source);
            const b = nodeById.get(e.target);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--border)"
                strokeWidth={1}
              />
            );
          })}
          {laidOut.nodes.map((n) => (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={NODE_RADIUS[n.role]} fill={ROLE_COLOR[n.role]} />
              <text
                x={n.x}
                y={n.y + NODE_RADIUS[n.role] + 14}
                textAnchor="middle"
                fill="var(--text-secondary)"
                fontSize={11}
              >
                {n.label}
              </text>
            </g>
          ))}
        </svg>
      )}
      <div style={s.legend}>
        {(Object.keys(ROLE_LABEL) as GraphNodeRole[]).map((role) => (
          <div key={role} style={s.legendRow}>
            <span style={{ ...s.legendDot, background: ROLE_COLOR[role] }} />
            <span>{ROLE_LABEL[role]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const s = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    background: "var(--bg-base, #0a0a0a)",
  } as React.CSSProperties,
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 1,
  } as React.CSSProperties,
  svg: {
    width: "100%",
    height: "100%",
  } as React.CSSProperties,
  empty: {
    display: "grid",
    placeItems: "center",
    height: "100%",
    color: "var(--text-muted)",
    fontSize: 14,
  } as React.CSSProperties,
  legend: {
    position: "absolute",
    left: 20,
    bottom: 20,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } as React.CSSProperties,
  legendRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as React.CSSProperties,
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
  } as React.CSSProperties,
};
