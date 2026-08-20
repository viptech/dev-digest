/* /skills/:id — Skill Editor (SPEC-06, Development Plan `skill-editor.md`
   Step 6). Mirrors `AgentEditorPage.tsx`'s `?tab=` + `VALID_TABS` +
   `ErrorState` pattern, but folds all of it into this single component
   (rather than splitting page.tsx/AgentEditor the way the agent route
   does) — `page.tsx` stays a thin `useParams` wrapper.

   Also mirrors `AgentEditorPage.tsx`'s left sidebar of sibling entities
   (list + search + "Add") so a skill author can switch between skills
   without leaving the editor — the Development Plan initially dropped this
   sidebar (read the spec's silence on it as "not called for"); course
   feedback against the reference mockup corrected that reading, so it's
   back, reusing `SkillCard`/`filterSkills`/`SkillDrawer` from
   `skills/_components/*` exactly as `SkillsListView` does.

   Tab bodies are wired here (Development Plan Step 10, T15) — same
   `tab === "..."` conditional-render shape as `AgentEditor.tsx:19-42`. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs, ErrorState, Skeleton, Badge, Icon, Button, Dropdown } from "@devdigest/ui";
import { useSkill, useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { SkillCard } from "@/app/skills/_components/SkillCard";
import { SkillDrawer } from "@/app/skills/_components/SkillDrawer";
import { filterSkills } from "./helpers";
import { ConfigTab } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
import { PreviewTab } from "./_components/PreviewTab";
import { EvalOwnerTab } from "@/components/eval-owner-tab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

// Derived from this component's own TABS (never a separately hand-maintained
// list) — the exact bug `AgentEditorPage.tsx:16-21`'s comment documents
// ("?tab=context" silently falling back to "config" because a hand-copied
// list went stale when a tab was added).
const VALID_TABS = TABS.map((t) => t.key);

export function SkillEditorView({ id }: { id: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const { data: skills } = useSkills();
  const update = useUpdateSkill();

  const [query, setQuery] = React.useState("");
  const [drawerMode, setDrawerMode] = React.useState<"none" | "create" | "import">("none");

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (tb: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", tb);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ];

  // Same combined branch shape as `AgentEditorPage.tsx:46-57` — a load
  // failure (network/other) and a resolved-but-missing skill (404) both land
  // on one full-screen ErrorState with Retry (no sidebar here either, same
  // as `AgentEditorPage`'s error branch).
  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.notFound.title")}
          body={error instanceof ApiError ? error.message : t("detail.notFound.body")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  const list = filterSkills(skills ?? [], query);

  return (
    <AppShell crumb={crumb}>
      {drawerMode !== "none" && <SkillDrawer mode={drawerMode} onClose={() => setDrawerMode("none")} />}
      <div style={s.wrap}>
        {/* left: sibling skill list, mirrors AgentEditorPage.tsx's agent sidebar */}
        <div style={s.sidebar}>
          <div style={s.sidebarHeader}>
            <div style={s.sidebarHeaderRow}>
              <h2 style={s.sidebarHeading}>{t("page.heading")}</h2>
              <Dropdown
                width={220}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                    {t("page.addSkill")}
                  </Button>
                }
                items={[
                  { label: t("page.menu.createFromScratch"), icon: "Edit", onClick: () => setDrawerMode("create") },
                  { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setDrawerMode("import") },
                  { label: t("page.menu.fromUrl"), icon: "Globe", muted: true },
                  { label: t("page.menu.community"), icon: "Search", muted: true },
                ]}
              />
            </div>
            <div style={s.sidebarSearch}>
              <Icon.Search size={13} style={s.sidebarSearchIcon} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                style={s.sidebarSearchInput}
              />
            </div>
          </div>
          <div style={s.sidebarList}>
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === id}
                onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        {/* right: editor */}
        {isLoading || !skill ? (
          <div style={s.mainLoading}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={s.main}>
            <div style={s.header}>
              <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
              <h1 style={{ fontSize: 18, fontWeight: 700 }}>{skill.name}</h1>
              <Badge color="var(--text-secondary)" mono>
                {t("preview.version", { version: skill.version })}
              </Badge>
              {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
            </div>
            <div style={s.tabsBar}>
              <Tabs tabs={tabs} value={tab} onChange={setTab} pad="0 28px" />
            </div>
            <div style={s.body}>
              {tab === "context" ? (
                <ContextTab skillId={skill.id} />
              ) : tab === "preview" ? (
                <PreviewTab skill={skill} />
              ) : tab === "evals" ? (
                <EvalOwnerTab ownerKind="skill" ownerId={skill.id} />
              ) : tab === "stats" ? (
                <StatsTab skillId={skill.id} />
              ) : tab === "versions" ? (
                <VersionsTab skillId={skill.id} />
              ) : (
                <ConfigTab skill={skill} />
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
