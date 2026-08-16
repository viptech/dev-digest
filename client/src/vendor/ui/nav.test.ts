import { describe, it, expect } from "vitest";
import { NAV, SHORTCUTS, resolveHref } from "./nav";

describe("nav", () => {
  it("has a Project Context item third in the WORKSPACE group, after pulls and onboarding-tour", () => {
    const workspace = NAV.find((g) => g.section === "WORKSPACE");
    expect(workspace).toBeDefined();
    const contextIdx = workspace!.items.findIndex((it) => it.key === "context");
    expect(contextIdx).toBe(2);
    expect(workspace!.items[0]?.key).toBe("pulls");
    const contextItem = workspace!.items[contextIdx];
    expect(contextItem?.gKey).toBe("x");
    expect(contextItem?.icon).toBe("FileText");
    expect(contextItem?.href).toBe("/repos/:repoId/context");
  });

  it("has an Onboarding Tour item second in the WORKSPACE group, right after pulls", () => {
    const workspace = NAV.find((g) => g.section === "WORKSPACE")!;
    const tourIdx = workspace.items.findIndex((it) => it.key === "onboarding-tour");
    expect(tourIdx).toBe(1);
    const tourItem = workspace.items[tourIdx];
    expect(tourItem?.label).toBe("Onboarding Tour");
    expect(tourItem?.icon).toBe("Workflow");
    expect(tourItem?.href).toBe("/repos/:repoId/onboarding");
    expect(tourItem?.gKey).toBe("t");
  });

  it("resolves the Project Context href against a repo id", () => {
    const workspace = NAV.find((g) => g.section === "WORKSPACE")!;
    const contextItem = workspace.items.find((it) => it.key === "context")!;
    expect(resolveHref(contextItem.href, "repo1")).toBe("/repos/repo1/context");
  });

  it("registers the g x shortcut", () => {
    expect(SHORTCUTS.some((s) => s.keys === "g x" && s.label === "Go to Project Context")).toBe(true);
  });

  it("registers the g t shortcut", () => {
    expect(SHORTCUTS.some((s) => s.keys === "g t" && s.label === "Go to Onboarding Tour")).toBe(true);
  });
});
