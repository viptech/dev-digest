import { useTranslations } from "next-intl";
import { MonoLink } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

/**
 * `reading_order` kind — numbered list, one entry per file in the server's
 * reading-order facts, in order; `link.label` carries the one-sentence
 * rationale for why that file is at that position (not a short title, per
 * the prompt's per-kind rule). An ungrounded `path` renders the rationale
 * alone, no path text and no Open link.
 */
export function ReadingOrderSection({
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
    <ol style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 20 }}>
      {section.links.map((link, i) => (
        <li key={`${link.path || link.label}-${i}`} style={{ fontSize: 13 }}>
          {link.path !== "" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="mono" style={{ color: "var(--text-secondary)" }}>
                {link.path}
              </span>
              {canLink && (
                <MonoLink href={githubBlobUrl(repoFullName!, defaultBranch!, link.path)}>
                  {t("openOnGithub")}
                </MonoLink>
              )}
            </div>
          )}
          <div style={{ color: "var(--text-primary)" }}>{link.label}</div>
        </li>
      ))}
    </ol>
  );
}
