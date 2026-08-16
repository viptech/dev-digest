import { useTranslations } from "next-intl";
import { Badge, MonoLink } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { COMPLEXITY_COLOR } from "../../constants";

/**
 * `first_tasks` kind — a 3-card grid from `tasks[]` (server-guaranteed
 * exactly 3, AC-22(г)). Each card shows the title, a complexity badge, and
 * the path as an "Open" link — but ONLY when `path !== ''`; an ungrounded
 * path (blanked by the server's grounding gate) renders the title alone,
 * with no path text and no link/button (no hallucinated path ever reaches
 * the DOM).
 */
export function FirstTasksSection({
  section,
  repoFullName,
  defaultBranch,
}: {
  section: OnboardingSection;
  repoFullName?: string | null;
  defaultBranch?: string | null;
}) {
  const t = useTranslations("onboarding");
  const tasks = section.tasks ?? [];
  const canLink = !!repoFullName && !!defaultBranch;

  if (tasks.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("noTasks")}</p>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
      {tasks.map((task, i) => (
        <div
          key={i}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            {task.title}
          </div>
          <Badge color={COMPLEXITY_COLOR[task.complexity]}>{task.complexity}</Badge>
          {task.path !== "" &&
            (canLink ? (
              <MonoLink href={githubBlobUrl(repoFullName!, defaultBranch!, task.path)}>
                {task.path}
              </MonoLink>
            ) : (
              <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {task.path}
              </span>
            ))}
        </div>
      ))}
    </div>
  );
}
