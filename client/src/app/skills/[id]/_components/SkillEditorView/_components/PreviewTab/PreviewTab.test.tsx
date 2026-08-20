import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";
import { PreviewTab } from "./PreviewTab";

function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: "s1",
    name: "PR Quality Rubric",
    description: "d",
    type: "rubric",
    source: "manual",
    body: "# Rule\n\nDescribe the rule.",
    enabled: true,
    version: 3,
    ...over,
  };
}

afterEach(() => cleanup());

describe("PreviewTab", () => {
  it("renders skill.body as markdown (AC-8)", () => {
    render(<PreviewTab skill={skill()} />);
    expect(screen.getByRole("heading", { name: "Rule" })).toBeInTheDocument();
    expect(screen.getByText("Describe the rule.")).toBeInTheDocument();
  });

  it("is read-only — no textarea or contentEditable node in the DOM (AC-9)", () => {
    const { container } = render(<PreviewTab skill={skill()} />);
    expect(container.querySelector("textarea")).not.toBeInTheDocument();
    expect(container.querySelector('[contenteditable="true"]')).not.toBeInTheDocument();
  });

  it("renders a literal <script> in an untrusted body as inert visible text, not a real script node", () => {
    const { container } = render(
      <PreviewTab
        skill={skill({
          source: "imported_url",
          enabled: false,
          body: "A rule with <script>alert(1)</script> embedded in it.",
        })}
      />,
    );
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
  });
});
