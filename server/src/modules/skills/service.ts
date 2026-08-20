import type { Skill, SkillStats, SkillVersion } from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { toSkillDto, toSkillVersionDto, parseMarkdownImport } from './helpers.js';
import { DEFAULT_SKILL_TYPE, IMPORTED_SOURCE, MANUAL_SOURCE } from './constants.js';
import type { Container } from '../../platform/container.js';
import type { SkillType } from '@devdigest/shared';
import { SkillStatsRepository } from './stats-repository.js';
import { computeSkillStats } from './stats-helpers.js';

/**
 * A1 — skills service. Business logic for the Skills Lab list/editor and the
 * import-from-file flow.
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type?: SkillType;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export interface ImportPreview {
  name: string;
  description: string;
  body: string;
}

export class SkillsService {
  private repo: SkillsRepository;
  private statsRepo: SkillStatsRepository;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
    this.statsRepo = new SkillStatsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type ?? DEFAULT_SKILL_TYPE,
      source: MANUAL_SOURCE,
      body: input.body,
      enabled: input.enabled,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Parse an uploaded markdown file into an editable, NOT-YET-SAVED preview. */
  importPreview(content: string): ImportPreview {
    return parseMarkdownImport(content);
  }

  /**
   * Save a confirmed import. Always `source: imported_url` (see constants.ts)
   * and always created DISABLED regardless of the caller's request — an
   * imported skill must be explicitly vetted + enabled from the preview/detail
   * view before it can be linked into a live agent prompt.
   */
  async importSave(
    workspaceId: string,
    input: { name: string; description: string; type?: SkillType; body: string },
  ): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type ?? DEFAULT_SKILL_TYPE,
      source: IMPORTED_SOURCE,
      body: input.body,
      enabled: false,
    });
    return toSkillDto(row);
  }

  /**
   * 30-day usage/quality aggregates for a skill (Stats tab, G6). Returns
   * undefined when the skill isn't in this workspace (route → 404), before
   * computing anything (AC-19-style access-control shape, mirrored here).
   */
  async getStats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const { agentIds, agentNames, runs, findings } = await this.statsRepo.getWindowData(workspaceId, id);
    return computeSkillStats({ skillId: id, skillName: skill.name, agentIds, agentNames, runs, findings });
  }

  /**
   * `body`-change history for a skill, newest version first (Versions tab,
   * G7). Workspace-ownership is checked HERE, before touching
   * `skill_versions` — `SkillsRepository.listVersions(skillId)` does not
   * itself take a `workspaceId` (AC-32), same idiom as
   * `ProjectContextService.listSkillDocs` (project-context/service.ts:138-142).
   * `undefined` = skill not found in this workspace (route → 404).
   */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }
}
