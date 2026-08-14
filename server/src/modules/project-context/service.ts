import type { Container } from '../../platform/container.js';
import { ProjectContextRepository, type ContextDocRow } from './repository.js';
import { discoverContextDocs, type ProjectContextCategory } from './discovery.js';
import { resolveInClone } from '../repo-intel/path-guard.js';

/** AC-15 (b): attach/read is scoped to `.md` files only — discovery only
 *  ever surfaces `.md` files (any root, not just specs/docs/insights, see
 *  discovery.ts), but the attach endpoint takes a client-supplied `path`
 *  independent of discovery, so this still needs its own, explicit check. */
function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * Project Context (SPEC-01) — business logic: discovery for a repo, attach/
 * detach/reorder for an agent or a skill (with the AC-15 traversal guard +
 * `.md`-extension check, and the workspace-ownership check for `repo_id`),
 * and the AC-9/AC-10 run-time resolution + dedup `ReviewRunExecutor` calls.
 *
 * No HTTP here (routes.ts), no raw SQL (repository.ts) — this is exactly the
 * onion-architecture service layer: orchestration + business rules only.
 */

export interface ProjectContextDocDto {
  path: string;
  category: ProjectContextCategory;
  chars: number;
  used_by_agents: number;
}

export interface ContextDocLinkDto {
  repo_id: string;
  path: string;
  order: number;
  owner: string;
  name: string;
}

export interface RejectedDoc {
  repo_id: string;
  path: string;
  reason: 'repo_not_in_workspace' | 'path_outside_clone' | 'not_a_markdown_file';
}

export type SetDocsResult =
  | { ok: true; docs: ContextDocLinkDto[] }
  | { ok: false; rejected: RejectedDoc[] };

/** One resolved document, ready for run-time injection (AC-9/AC-10/AC-11). */
export interface ResolvedContextDoc {
  repoId: string;
  owner: string;
  name: string;
  path: string;
}

export class ProjectContextService {
  private repo: ProjectContextRepository;

  constructor(private container: Container) {
    this.repo = new ProjectContextRepository(container.db);
  }

  /**
   * AC-1, AC-2: every discovered `.md` document for `repoId`, with its
   * server-computed category and direct-attachment usage count.
   * AC-3: no clone yet → `[]`, not an error. `undefined` = repo not in
   * `workspaceId` (404-equivalent, same convention as `AgentsService.get`).
   */
  async discoverForRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<ProjectContextDocDto[] | undefined> {
    const repo = await this.repo.getRepoForContext(repoId);
    if (!repo || repo.workspaceId !== workspaceId) return undefined;
    if (!repo.clonePath) return [];
    const discovered = await discoverContextDocs(repo.clonePath);
    const usage = await this.repo.usageCounts(repoId);
    return discovered.map((d) => ({
      path: d.path,
      category: d.category,
      chars: d.chars,
      used_by_agents: usage.get(d.path) ?? 0,
    }));
  }

  /**
   * Full text of one discovered document — backs the "Preview" action
   * (AC-4's row-level Preview, and the Project Context page's detail
   * panel). Same validity checks as attach-time (AC-15), but read-only —
   * failure of any kind (repo not in workspace, path outside clone, not a
   * `.md` file, file missing) is a uniform `undefined` (404), no need to distinguish
   * 422 vs 404 for a non-mutating read.
   */
  async readDocContent(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<{ content: string } | undefined> {
    const repo = await this.repo.getRepoForContext(repoId);
    if (!repo || repo.workspaceId !== workspaceId) return undefined;
    if (!repo.clonePath || !resolveInClone(repo.clonePath, path) || !isMarkdownPath(path)) {
      return undefined;
    }
    const [file] = await this.container.repoIntel.readFiles(repoId, [path]);
    return file ? { content: file.content } : undefined;
  }

  private async listAgentDocsRaw(agentId: string): Promise<ContextDocLinkDto[]> {
    return (await this.repo.listAgentDocs(agentId)).map(toDto);
  }

  private async listSkillDocsRaw(skillId: string): Promise<ContextDocLinkDto[]> {
    return (await this.repo.listSkillDocs(skillId)).map(toDto);
  }

  /**
   * Scope-checked (agent must belong to `workspaceId`) — the ownership
   * check belongs here, not in `routes.ts` (architecture-review finding:
   * these two GET methods were the only ones in the server that skipped
   * this and left it to the route). `undefined` = agent not found in that
   * workspace, same 404-equivalent convention as `setAgentDocs`.
   */
  async listAgentDocs(workspaceId: string, agentId: string): Promise<ContextDocLinkDto[] | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    return this.listAgentDocsRaw(agentId);
  }

  /** Same contract as `listAgentDocs`, skill-scoped. */
  async listSkillDocs(workspaceId: string, skillId: string): Promise<ContextDocLinkDto[] | undefined> {
    const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.listSkillDocsRaw(skillId);
  }

  /**
   * Scope-checked (agent must belong to `workspaceId`) + AC-15-validated
   * set/reorder. `undefined` = agent not found in that workspace.
   */
  async setAgentDocs(
    workspaceId: string,
    agentId: string,
    docs: { repo_id: string; path: string }[],
  ): Promise<SetDocsResult | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rejected = await this.validateAll(workspaceId, docs);
    if (rejected.length > 0) return { ok: false, rejected };
    await this.repo.setAgentDocs(
      agentId,
      docs.map((d) => ({ repoId: d.repo_id, path: d.path })),
    );
    return { ok: true, docs: await this.listAgentDocsRaw(agentId) };
  }

  /** Same contract as `setAgentDocs`, skill-scoped (AC-7). */
  async setSkillDocs(
    workspaceId: string,
    skillId: string,
    docs: { repo_id: string; path: string }[],
  ): Promise<SetDocsResult | undefined> {
    const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rejected = await this.validateAll(workspaceId, docs);
    if (rejected.length > 0) return { ok: false, rejected };
    await this.repo.setSkillDocs(
      skillId,
      docs.map((d) => ({ repoId: d.repo_id, path: d.path })),
    );
    return { ok: true, docs: await this.listSkillDocsRaw(skillId) };
  }

  /**
   * AC-15's attach-time gate, applied to every doc in a set/reorder request
   * before ANY write — a single rejected doc rejects the whole request
   * (422), never partially persists.
   */
  private async validateAll(
    callerWorkspaceId: string,
    docs: { repo_id: string; path: string }[],
  ): Promise<RejectedDoc[]> {
    const rejected: RejectedDoc[] = [];
    for (const d of docs) {
      const r = await this.validateAttachedDoc(callerWorkspaceId, d.repo_id, d.path);
      if (r) rejected.push(r);
    }
    return rejected;
  }

  private async validateAttachedDoc(
    callerWorkspaceId: string,
    repoId: string,
    path: string,
  ): Promise<RejectedDoc | null> {
    const repo = await this.repo.getRepoForContext(repoId);
    // NFR "Контроль доступу": repo_id must belong to the caller's own
    // workspace — otherwise a compromised client could read another
    // workspace's repo content by supplying an arbitrary repo_id.
    if (!repo || repo.workspaceId !== callerWorkspaceId) {
      return { repo_id: repoId, path, reason: 'repo_not_in_workspace' };
    }
    // AC-15 (a): stays inside THIS document's own bound repo's clone dir.
    if (!repo.clonePath || !resolveInClone(repo.clonePath, path)) {
      return { repo_id: repoId, path, reason: 'path_outside_clone' };
    }
    // AC-15 (b): AND is a `.md` file — attach/discover scope is "every
    // markdown file in the repo" now, not just specs/docs/insights, but a
    // client-supplied path could still name a non-.md file that happens to
    // resolve inside the clone.
    if (!isMarkdownPath(path)) {
      return { repo_id: repoId, path, reason: 'not_a_markdown_file' };
    }
    return null;
  }

  /**
   * AC-9/AC-10 — an agent's run-time document set: the agent's own attached
   * docs first (in its saved order), then each linked+**enabled** skill's
   * docs (in link order, then that skill's own saved order), deduped on
   * `(repoId, path)` keeping the FIRST occurrence — agent-level always wins.
   * Called once per run by `ReviewRunExecutor.buildProjectContextDigest`.
   */
  async resolveAgentContext(agentId: string): Promise<ResolvedContextDoc[]> {
    const ownDocs = await this.repo.listAgentDocs(agentId);
    const linkedSkills = await this.container.agentsRepo.linkedSkills(agentId);
    const enabledSkillIds = linkedSkills.filter((l) => l.skill.enabled).map((l) => l.skill.id);

    const skillDocs: ContextDocRow[] = [];
    for (const skillId of enabledSkillIds) {
      skillDocs.push(...(await this.repo.listSkillDocs(skillId)));
    }

    const seen = new Set<string>();
    const out: ResolvedContextDoc[] = [];
    for (const row of [...ownDocs, ...skillDocs]) {
      const key = `${row.repoId}:${row.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ repoId: row.repoId, owner: row.owner, name: row.name, path: row.path });
    }
    return out;
  }
}

function toDto(row: ContextDocRow): ContextDocLinkDto {
  return {
    repo_id: row.repoId,
    path: row.path,
    order: row.order,
    owner: row.owner,
    name: row.name,
  };
}
