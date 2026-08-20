import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Development Plan `skill-editor.md` Step 5 (SPEC-06 T8/AC-17) — every
 *  eval hook now takes `{ ownerKind, ownerId }` and routes through
 *  `/agents/:id/...` or `/skills/:id/...` accordingly. These tests assert
 *  the base path directly against a mocked `api` (same pattern as
 *  `agents.test.ts`/`skills.test.ts`), rather than through a component-level
 *  mock of this whole module, since the routing logic lives here. */
const { get, post } = vi.hoisted(() => ({
  get: vi.fn(() => Promise.resolve([])),
  post: vi.fn(() => Promise.resolve({})),
}));

vi.mock("../api", () => ({
  api: { get, post },
}));

import { useEvalCases, useRunEvalSet, useRunEvalCase } from "./evals";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("evals hooks — ownerKind routing", () => {
  it("useEvalCases GETs /agents/:id/evals for an agent owner", async () => {
    const { result } = renderHook(() => useEvalCases({ ownerKind: "agent", ownerId: "ag1" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/agents/ag1/evals");
  });

  it("useEvalCases GETs /skills/:id/evals for a skill owner, not /agents/...", async () => {
    const { result } = renderHook(() => useEvalCases({ ownerKind: "skill", ownerId: "sk1" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/skills/sk1/evals");
  });

  it("useRunEvalSet POSTs /agents/:id/eval-runs for an agent owner", async () => {
    const { result } = renderHook(() => useRunEvalSet({ ownerKind: "agent", ownerId: "ag1" }), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith("/agents/ag1/eval-runs");
  });

  it("useRunEvalSet POSTs /skills/:id/eval-runs for a skill owner, not /agents/...", async () => {
    const { result } = renderHook(() => useRunEvalSet({ ownerKind: "skill", ownerId: "sk1" }), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith("/skills/sk1/eval-runs");
  });

  it("useRunEvalCase POSTs /skills/:id/evals/:caseId/run for a skill owner", async () => {
    const { result } = renderHook(() => useRunEvalCase({ ownerKind: "skill", ownerId: "sk1" }), { wrapper });
    result.current.mutate("case1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith("/skills/sk1/evals/case1/run");
  });
});
