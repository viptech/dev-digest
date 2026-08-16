import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentContextDocLink } from "@devdigest/shared";

const fixture: AgentContextDocLink[] = [
  { agent_id: "ag1", repo_id: "repo1", path: "specs/a.md", order: 0, owner: "acme", name: "api" },
];

vi.mock("../api", () => ({
  api: {
    post: vi.fn(() => Promise.resolve(fixture)),
  },
}));

import { useSetAgentContextDocs } from "./agents";

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSetAgentContextDocs", () => {
  it("invalidates the repo-context-docs cache (scoped predicate) on success", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["repo-context-docs", "repo1"], [{ path: "specs/a.md" }]);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result } = renderHook(() => useSetAgentContextDocs("ag1"), { wrapper });

    result.current.mutate([{ repo_id: "repo1", path: "specs/a.md" }]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryState(["repo-context-docs", "repo1"])?.isInvalidated).toBe(true);
  });
});
