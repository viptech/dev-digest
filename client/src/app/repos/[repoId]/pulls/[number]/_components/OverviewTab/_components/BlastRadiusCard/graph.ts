import type { BlastRadius } from "@devdigest/shared";

/**
 * Pure graph-building + force-directed layout for the Blast Radius "Graph"
 * view. No dependency added — this app already hand-rolls its other
 * visualizations as plain SVG (`CircularScore`, `Sparkline`), and the graphs
 * here are small (a PR's changed symbols + their direct callers/endpoints),
 * so a basic physics simulation is plenty and keeps the same style.
 */

export type GraphNodeRole = "changed_symbol" | "caller" | "endpoint";

export interface GraphNode {
  id: string;
  label: string;
  role: GraphNodeRole;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Builds graph nodes/edges from a `BlastRadius` snapshot: one node per
 * changed symbol, one per unique caller (by file:line), one per unique
 * endpoint/cron (crons share the "endpoint" color — the legend has no
 * separate cron bucket), and an edge from each changed symbol to each of
 * its callers/endpoints/crons. A symbol with no callers/endpoints renders as
 * an isolated node (matches `changed_symbols` entries that never appear in
 * `downstream`, e.g. an unexported or unreferenced symbol).
 */
export function buildGraphData(blast: Pick<BlastRadius, "changed_symbols" | "downstream">): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const symbolNodeId = new Map<string, string>(); // symbol name -> node id
  for (const sym of blast.changed_symbols) {
    const id = `sym:${sym.file}:${sym.name}`;
    nodes.set(id, { id, label: sym.name, role: "changed_symbol" });
    if (!symbolNodeId.has(sym.name)) symbolNodeId.set(sym.name, id);
  }

  for (const impact of blast.downstream) {
    // `downstream[].symbol` is a bare name — resolve back to its node id, or
    // (defensively) create one if `changed_symbols` didn't already cover it.
    let symId = symbolNodeId.get(impact.symbol);
    if (!symId) {
      symId = `sym:${impact.symbol}`;
      nodes.set(symId, { id: symId, label: impact.symbol, role: "changed_symbol" });
      symbolNodeId.set(impact.symbol, symId);
    }

    for (const caller of impact.callers) {
      const callerId = `caller:${caller.file}:${caller.line}`;
      if (!nodes.has(callerId)) {
        nodes.set(callerId, {
          id: callerId,
          label: truncate(`${basename(caller.file)}:${caller.line}`, 18),
          role: "caller",
        });
      }
      edges.push({ source: symId, target: callerId });
    }

    for (const endpoint of [...impact.endpoints_affected, ...impact.crons_affected]) {
      const endpointId = `endpoint:${endpoint}`;
      if (!nodes.has(endpointId)) {
        nodes.set(endpointId, { id: endpointId, label: truncate(endpoint, 24), role: "endpoint" });
      }
      edges.push({ source: symId, target: endpointId });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
}

/**
 * Basic force-directed layout (repulsion between every node pair + spring
 * attraction along edges + gentle centering), run for a fixed number of
 * iterations rather than until convergence — deterministic runtime, no
 * "still moving after N ms" edge case for a caller to worry about. Fast
 * enough for this feature's scale (a PR's blast graph is at most a few dozen
 * nodes): O(nodes² · iterations).
 */
export function computeForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations = 300,
): LaidOutNode[] {
  if (nodes.length === 0) return [];

  const REPULSION = 6000;
  const SPRING_LENGTH = 120;
  const SPRING_STRENGTH = 0.02;
  const CENTER_STRENGTH = 0.01;
  const DAMPING = 0.85;

  // Deterministic initial placement (a circle around the center) — no
  // Math.random, so the same input always lays out the same way.
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const radius = Math.min(width, height) * 0.3;
    positions.set(n.id, {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    });
  });

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions.get(nodes[i]!.id)!;
        const b = positions.get(nodes[j]!.id)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    for (const e of edges) {
      const a = positions.get(e.source);
      const b = positions.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const n of nodes) {
      const p = positions.get(n.id)!;
      p.vx += (width / 2 - p.x) * CENTER_STRENGTH;
      p.vy += (height / 2 - p.y) * CENTER_STRENGTH;
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  return nodes.map((n) => {
    const p = positions.get(n.id)!;
    return { ...n, x: p.x, y: p.y };
  });
}
