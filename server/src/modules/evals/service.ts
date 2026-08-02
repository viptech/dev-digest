import type { EvalCase, EvalRun, Provider } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { AgentsRepository } from '../agents/repository.js';
import { EvalsRepository } from './repository.js';
import {
  toEvalCaseDto,
  toEvalRunDto,
  matchFindings,
  parseGroundingRatio,
  type ExpectedFinding,
} from './helpers.js';

export interface CreateEvalCaseInput {
  name: string;
  input_diff?: string;
  input_meta?: unknown;
  expected_output?: unknown;
  notes?: string;
}

export type UpdateEvalCaseInput = Partial<CreateEvalCaseInput>;

export class EvalsService {
  private repo: EvalsRepository;
  private agents: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new EvalsRepository(container.db);
    this.agents = container.agentsRepo;
  }

  async list(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const rows = await this.repo.listByOwner(workspaceId, 'agent', agentId);
    return rows.map(toEvalCaseDto);
  }

  async create(workspaceId: string, agentId: string, input: CreateEvalCaseInput): Promise<EvalCase> {
    const row = await this.repo.insert({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output ?? null,
      notes: input.notes ?? null,
    });
    return toEvalCaseDto(row);
  }

  async update(
    workspaceId: string,
    caseId: string,
    patch: UpdateEvalCaseInput,
  ): Promise<EvalCase | undefined> {
    const row = await this.repo.update(workspaceId, caseId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined ? { expectedOutput: patch.expected_output } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  async delete(workspaceId: string, caseId: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, caseId);
  }

  /**
   * Run one eval case against the agent's LIVE config (system prompt, model,
   * and its currently linked+enabled skills — same resolution Plan A wired
   * into run-executor.ts). No repo-intel enrichment: an eval case is an
   * isolated fixture diff, not tied to a cloned repo.
   */
  async run(
    workspaceId: string,
    agentId: string,
    caseId: string,
  ): Promise<{ case: EvalCase; run: EvalRun } | undefined> {
    const evalCase = await this.repo.getById(workspaceId, caseId);
    if (!evalCase || evalCase.ownerId !== agentId) return undefined;

    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const linkedSkills = await this.agents.linkedSkills(agentId);
    const skillBodies = linkedSkills.filter((l) => l.skill.enabled).map((l) => l.skill.body);

    const diff = parseUnifiedDiff(evalCase.inputDiff ?? '');
    const llm = await this.container.llm(agent.provider as Provider);
    const meta = (evalCase.inputMeta ?? {}) as { title?: string; body?: string };
    const task = meta.title ? `Review: "${meta.title}"` : undefined;

    const start = Date.now();
    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm,
      strategy: 'single-pass',
      ...(skillBodies.length ? { skills: skillBodies } : {}),
      ...(task ? { task } : {}),
      ...(meta.body ? { prDescription: meta.body } : {}),
      sessionId: `eval:${caseId}`,
    });
    const durationMs = Date.now() - start;

    const expected = (Array.isArray(evalCase.expectedOutput) ? evalCase.expectedOutput : []) as ExpectedFinding[];
    const match = matchFindings(expected, outcome.review.findings);
    const citationAccuracy = parseGroundingRatio(outcome.grounding);

    const runRow = await this.repo.insertRun({
      caseId,
      actualOutput: outcome.review.findings,
      pass: match.pass,
      recall: match.recall,
      precision: match.precision,
      citationAccuracy,
      durationMs,
      costUsd: outcome.costUsd,
    });

    return { case: toEvalCaseDto(evalCase), run: toEvalRunDto(runRow) };
  }
}
