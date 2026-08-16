/* hooks/skills.ts — React Query hooks for the A1 Skills Lab + Agent Editor
   Skills tab. Mirrors hooks/agents.ts. */
"use client";

import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, SkillContextDocLink, SkillType } from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type?: SkillType;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

// ---- Project Context (SPEC-01) — Skill drawer "Project context to use" ---

export function useSkillContextDocs(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context-docs", skillId],
    queryFn: () => api.get<SkillContextDocLink[]>(`/skills/${skillId}/context-docs`),
    enabled: !!skillId,
  });
}

/** Replace the whole ordered set of attached docs for a skill (AC-7). */
export function useSetSkillContextDocs(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docs: { repo_id: string; path: string }[]) =>
      api.post<SkillContextDocLink[]>(`/skills/${skillId}/context-docs`, { docs }),
    onSuccess: (data) => {
      qc.setQueryData(["skill-context-docs", skillId], data);
      // Scoped predicate, not an unscoped invalidateQueries() — see the
      // matching comment on useSetAgentContextDocs (hooks/agents.ts).
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "repo-context-docs" });
    },
  });
}

/**
 * Context docs for a SET of skills at once (SPEC-02, T4) — backs the Agent
 * editor's Context tab aggregate badge, which needs every enabled linked
 * skill's docs to compute the combined "own + from skills" count. Mirrors
 * `useContextDocsCharsMap`'s `useQueries` shape (`hooks/project-context.ts`):
 * one query per id, using the SAME query key shape as `useSkillContextDocs`
 * (`["skill-context-docs", skillId]`) so the cache is shared and viewing a
 * skill's own drawer never double-fetches. Calling `useSkillContextDocs` once
 * per item inside a `.map()` would violate the rules of hooks here (the
 * number of linked skills can change across renders) — `useQueries` is the
 * safe, variable-length-list equivalent.
 */
export function useSkillsContextDocs(skillIds: string[]): Map<string, SkillContextDocLink[]> {
  const results = useQueries({
    queries: skillIds.map((skillId) => ({
      queryKey: ["skill-context-docs", skillId],
      queryFn: () => api.get<SkillContextDocLink[]>(`/skills/${skillId}/context-docs`),
    })),
  });
  const map = new Map<string, SkillContextDocLink[]>();
  for (let i = 0; i < skillIds.length; i++) {
    const skillId = skillIds[i];
    const docs = results[i]?.data;
    if (!skillId || !docs) continue;
    map.set(skillId, docs);
  }
  return map;
}

export interface ImportPreviewResult {
  name: string;
  description: string;
  body: string;
}

/** Step 1 of import: parse a .md file's TEXT content (read client-side via
 *  FileReader — no multipart upload). Does NOT persist anything. */
export function useImportPreview() {
  return useMutation({
    mutationFn: (input: { filename: string; content: string }) =>
      api.post<ImportPreviewResult>("/skills/import/preview", input),
  });
}

/** Step 2 of import: persist the (possibly user-edited) preview. Always
 *  created disabled + source=imported_url on the server. */
export function useImportSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description: string; type?: SkillType; body: string }) =>
      api.post<Skill>("/skills/import", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}
