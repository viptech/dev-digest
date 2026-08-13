import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBriefSnapshot } from "@devdigest/shared";

const post = vi.fn();

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: (...args: unknown[]) => post(...args),
  },
}));

import { useGenerateBrief } from "./brief";

const rollup: PrBriefSnapshot["review_rollup"] = {
  verdict: "approve",
  score: 90,
  findings_summary: { counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }, items: [] },
  blockers_count: 0,
  summary: "Looks good.",
  cost_usd: 0.01,
  tokens_in: 100,
  tokens_out: 50,
};

const populatedBrief: PrBriefSnapshot["brief"] = {
  what: "Adds a rate limiter to the login endpoint.",
  why: "Prevents brute-force attempts against user accounts.",
  risk_level: "medium",
  risks: [],
  review_focus: [],
};

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useGenerateBrief", () => {
  it("posts to /pulls/:id/brief and writes a successful, non-degraded response into the [\"brief\", prId] cache verbatim", async () => {
    const success: PrBriefSnapshot = {
      review_rollup: rollup,
      brief: populatedBrief,
      brief_generated_at: "2026-08-13T00:00:00.000Z",
    };
    post.mockResolvedValue(success);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useGenerateBrief("pr-1"), { wrapper: wrapper(qc) });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(post).toHaveBeenCalledWith("/pulls/pr-1/brief");
    expect(qc.getQueryData(["brief", "pr-1"])).toEqual(success);
  });

  it("merges a degraded response with no brief of its own into a previously cached, valid brief instead of erasing it (M3 regression)", async () => {
    const cached: PrBriefSnapshot = {
      review_rollup: rollup,
      brief: populatedBrief,
      brief_generated_at: "2026-08-13T00:00:00.000Z",
    };
    const degraded: PrBriefSnapshot = {
      review_rollup: rollup,
      brief: null,
      brief_generated_at: null,
      brief_degraded: true,
    };
    post.mockResolvedValue(degraded);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["brief", "pr-1"], cached);

    const { result } = renderHook(() => useGenerateBrief("pr-1"), { wrapper: wrapper(qc) });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryData(["brief", "pr-1"])).toEqual({
      review_rollup: rollup,
      brief: populatedBrief,
      brief_generated_at: "2026-08-13T00:00:00.000Z",
      brief_degraded: true,
    });
  });

  it("writes a degraded response as-is when there was no prior cached brief to fall back to", async () => {
    const degraded: PrBriefSnapshot = {
      review_rollup: null,
      brief: null,
      brief_generated_at: null,
      brief_degraded: true,
    };
    post.mockResolvedValue(degraded);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useGenerateBrief("pr-1"), { wrapper: wrapper(qc) });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryData(["brief", "pr-1"])).toEqual(degraded);
  });
});
