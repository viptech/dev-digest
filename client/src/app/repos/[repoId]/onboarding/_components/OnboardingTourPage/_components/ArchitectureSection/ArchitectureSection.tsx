import { Markdown } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { MermaidDiagram } from "@/components/mermaid-diagram";

/**
 * `architecture` kind — prose body (Markdown, unmodified renderer — no
 * `rehype-raw`, so any literal `<script>`/HTML in the model's output renders
 * as inert visible text, never executes) + at most one mermaid diagram.
 * `MermaidDiagram` itself renders nothing for invalid/non-diagram input.
 */
export function ArchitectureSection({ section }: { section: OnboardingSection }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Markdown>{section.body}</Markdown>
      {section.diagram && <MermaidDiagram chart={section.diagram} />}
    </div>
  );
}
