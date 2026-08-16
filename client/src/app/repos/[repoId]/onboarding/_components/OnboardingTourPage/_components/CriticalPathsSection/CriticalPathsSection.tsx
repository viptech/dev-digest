import { useTranslations } from "next-intl";
import { MonoLink } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

/**
 * `critical_paths` kind — one row per unique file across the flattened
 * critical-path chains: mono-space path, one-line reason (`link.label`), and
 * an "Open" link to GitHub. An ungrounded `path` (blanked to `''` by the
 * server's grounding gate, AC-6) renders NO path text and NO Open button —
 * only the reason line survives, never a hallucinated path string.
 */
export function CriticalPathsSection({
  section,
  repoFullName,
  defaultBranch,
}: {
  section: OnboardingSection;
  repoFullName?: string | null;
  defaultBranch?: string | null;
}) {
  const t = useTranslations("onboarding");
  const canLink = !!repoFullName && !!defaultBranch;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {section.links.map((link, i) => (
        <div
          key={`${link.path || link.label}-${i}`}
          style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
        >
          {link.path !== "" && (
            <>
              <span className="mono" style={{ color: "var(--text-secondary)" }}>
                {link.path}
              </span>
              <span style={{ color: "var(--text-muted)" }}>—</span>
            </>
          )}
          <span style={{ flex: 1, color: "var(--text-primary)" }}>{link.label}</span>
          {link.path !== "" && canLink && (
            <MonoLink href={githubBlobUrl(repoFullName!, defaultBranch!, link.path)}>
              {t("openOnGithub")}
            </MonoLink>
          )}
        </div>
      ))}
    </div>
  );
}
