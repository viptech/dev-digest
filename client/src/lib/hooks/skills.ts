/* hooks/skills.ts — React Query hooks for the A1 Skills Lab + Agent Editor
   Skills tab. Mirrors hooks/agents.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
    },
  });
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
