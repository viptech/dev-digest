import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import projectContextMessages from "../../../../../../messages/en/projectContext.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
  useAgentContextDocs: () => ({ data: [] }),
  useSetAgentContextDocs: () => ({ mutate: vi.fn(), isPending: false }),
  useAgentSkills: () => ({ data: [] }),
}));
vi.mock("../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: [] }),
  useSkillsContextDocs: () => new Map(),
}));
vi.mock("../../../../../components/context-doc-picker", () => ({
  ContextDocPicker: () => <div>context-doc-picker</div>,
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, projectContext: projectContextMessages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it(
    "renders the Context tab (SPEC-01) — regression for the bug where " +
      "?tab=context silently fell back to config because the page's own " +
      "VALID_TABS list wasn't kept in sync with AgentEditor's TABS",
    () => {
      renderWithIntl(<AgentEditor agent={AGENT} tab="context" onTab={() => {}} />);
      expect(screen.getByText("context-doc-picker")).toBeInTheDocument();
      expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
    },
  );
});
