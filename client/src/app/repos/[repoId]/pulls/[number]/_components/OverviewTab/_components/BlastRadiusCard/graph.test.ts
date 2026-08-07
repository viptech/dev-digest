import { describe, it, expect } from "vitest";
import type { BlastRadius } from "@devdigest/shared";
import { buildGraphData, computeForceLayout } from "./graph";

function blast(overrides: Partial<BlastRadius> = {}): Pick<BlastRadius, "changed_symbols" | "downstream"> {
  return {
    changed_symbols: [{ file: "src/helper.ts", name: "sharedHelper", kind: "function" }],
    downstream: [
      {
        symbol: "sharedHelper",
        callers: [
          { name: "handleRequest", file: "src/route.ts", line: 42 },
          { name: "processJob", file: "src/worker.ts", line: 7 },
        ],
        endpoints_affected: ["GET /widgets"],
        crons_affected: ["nightly-cleanup"],
      },
    ],
    ...overrides,
  };
}

describe("buildGraphData", () => {
  it("creates one node per changed symbol, caller, and endpoint/cron", () => {
    const { nodes } = buildGraphData(blast());
    expect(nodes.filter((n) => n.role === "changed_symbol")).toHaveLength(1);
    expect(nodes.filter((n) => n.role === "caller")).toHaveLength(2);
    expect(nodes.filter((n) => n.role === "endpoint")).toHaveLength(2); // 1 endpoint + 1 cron, same bucket
  });

  it("creates an edge from the changed symbol to each caller and endpoint/cron", () => {
    const { edges, nodes } = buildGraphData(blast());
    const symId = nodes.find((n) => n.role === "changed_symbol")!.id;
    expect(edges.filter((e) => e.source === symId)).toHaveLength(4); // 2 callers + 1 endpoint + 1 cron
  });

  it("a changed symbol with no downstream entry renders as an isolated node (no edges)", () => {
    const data = blast({
      changed_symbols: [
        { file: "src/helper.ts", name: "sharedHelper", kind: "function" },
        { file: "src/unused.ts", name: "neverCalled", kind: "function" },
      ],
      downstream: [
        {
          symbol: "sharedHelper",
          callers: [{ name: "handleRequest", file: "src/route.ts", line: 42 }],
          endpoints_affected: [],
          crons_affected: [],
        },
      ],
    });
    const { nodes, edges } = buildGraphData(data);
    const isolated = nodes.find((n) => n.label === "neverCalled")!;
    expect(edges.some((e) => e.source === isolated.id || e.target === isolated.id)).toBe(false);
  });

  it("dedupes a caller referenced from the same file:line only once", () => {
    const data = blast({
      downstream: [
        {
          symbol: "sharedHelper",
          callers: [
            { name: "handleRequest", file: "src/route.ts", line: 42 },
            { name: "handleRequest", file: "src/route.ts", line: 42 },
          ],
          endpoints_affected: [],
          crons_affected: [],
        },
      ],
    });
    const { nodes } = buildGraphData(data);
    expect(nodes.filter((n) => n.role === "caller")).toHaveLength(1);
  });

  it("truncates long caller/endpoint labels", () => {
    const data = blast({
      downstream: [
        {
          symbol: "sharedHelper",
          callers: [{ name: "x", file: "src/very/deeply/nested/path/to/a/file.ts", line: 999 }],
          endpoints_affected: ["POST /api/v1/organizations/:orgId/members/:memberId/permissions"],
          crons_affected: [],
        },
      ],
    });
    const { nodes } = buildGraphData(data);
    const caller = nodes.find((n) => n.role === "caller")!;
    const endpoint = nodes.find((n) => n.role === "endpoint")!;
    expect(caller.label.length).toBeLessThanOrEqual(18);
    expect(endpoint.label.length).toBeLessThanOrEqual(24);
  });
});

describe("computeForceLayout", () => {
  it("returns a finite (x, y) for every node, with no NaN/Infinity", () => {
    const { nodes, edges } = buildGraphData(blast());
    const laidOut = computeForceLayout(nodes, edges, 800, 600, 50);
    expect(laidOut).toHaveLength(nodes.length);
    for (const n of laidOut) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it("is deterministic — the same input lays out identically every run", () => {
    const { nodes, edges } = buildGraphData(blast());
    const a = computeForceLayout(nodes, edges, 800, 600, 50);
    const b = computeForceLayout(nodes, edges, 800, 600, 50);
    expect(a).toEqual(b);
  });

  it("returns an empty array for an empty graph", () => {
    expect(computeForceLayout([], [], 800, 600)).toEqual([]);
  });

  it("connected nodes end up closer together than to an unrelated isolated node", () => {
    const data = blast({
      changed_symbols: [
        { file: "src/helper.ts", name: "sharedHelper", kind: "function" },
        { file: "src/unused.ts", name: "neverCalled", kind: "function" },
      ],
      downstream: [
        {
          symbol: "sharedHelper",
          callers: [{ name: "handleRequest", file: "src/route.ts", line: 42 }],
          endpoints_affected: [],
          crons_affected: [],
        },
      ],
    });
    const { nodes, edges } = buildGraphData(data);
    const laidOut = computeForceLayout(nodes, edges, 800, 600, 300);
    const byId = new Map(laidOut.map((n) => [n.id, n]));
    const sym = byId.get(nodes.find((n) => n.label === "sharedHelper")!.id)!;
    const caller = byId.get(nodes.find((n) => n.role === "caller")!.id)!;
    const isolated = byId.get(nodes.find((n) => n.label === "neverCalled")!.id)!;

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);

    expect(dist(sym, caller)).toBeLessThan(dist(sym, isolated));
  });
});
