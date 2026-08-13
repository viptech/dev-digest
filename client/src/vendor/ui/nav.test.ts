import { describe, it, expect } from "vitest";
import { NAV, SHORTCUTS, resolveHref } from "./nav";

describe("nav", () => {
  it("has a Project Context item second in the WORKSPACE group, right after pulls", () => {
    const workspace = NAV.find((g) => g.section === "WORKSPACE");
    expect(workspace).toBeDefined();
    const contextIdx = workspace!.items.findIndex((it) => it.key === "context");
    expect(contextIdx).toBe(1);
    expect(workspace!.items[0]?.key).toBe("pulls");
    const contextItem = workspace!.items[contextIdx];
    expect(contextItem?.gKey).toBe("x");
    expect(contextItem?.icon).toBe("FileText");
    expect(contextItem?.href).toBe("/repos/:repoId/context");
  });

  it("resolves the Project Context href against a repo id", () => {
    const workspace = NAV.find((g) => g.section === "WORKSPACE")!;
    const contextItem = workspace.items.find((it) => it.key === "context")!;
    expect(resolveHref(contextItem.href, "repo1")).toBe("/repos/repo1/context");
  });

  it("registers the g x shortcut", () => {
    expect(SHORTCUTS.some((s) => s.keys === "g x" && s.label === "Go to Project Context")).toBe(true);
  });
});
