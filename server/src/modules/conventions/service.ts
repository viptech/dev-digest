import type { ConventionCandidate, Provider } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { ConventionsRepository } from './repository.js';
import {
  toConventionDto,
  ConventionFileSelectionSchema,
  ConventionExtractionSchema,
} from './helpers.js';
import { MAX_CANDIDATES, MAX_FILE_CHARS, MAX_SELECTED_FILES, SAMPLE_COUNT } from './constants.js';

export interface UpdateConventionInput {
  rule?: string;
  accepted?: boolean;
}

/** Minimal structured logger (pino-compatible: (obj, msg)) — mirrors reviews/run-executor.ts's Logger. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConventionInput,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.updateOne(workspaceId, id, patch);
    return row ? toConventionDto(row) : undefined;
  }

  /**
   * 2-step LLM extraction: (1) pick which of the top-ranked sample files are
   * worth reading, (2) read those files and extract rule candidates with
   * evidence. Degrades to [] (no throw) when repo-intel has no samples or
   * the clone has no readable files — matches repo-intel's existing
   * best-effort contract.
   */
  async extract(workspaceId: string, repoId: string, logger?: Logger): Promise<ConventionCandidate[]> {
    const samples = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_COUNT);
    if (samples.length === 0) {
      logger?.warn(
        { repoId, workspaceId },
        'conventions.extract: no candidate files from repo-intel — repo may not be indexed',
      );
      return this.list(workspaceId, repoId);
    }

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider as Provider);

    const selection = await llm.completeStructured({
      model,
      schema: ConventionFileSelectionSchema,
      schemaName: 'ConventionFileSelection',
      messages: [
        {
          role: 'system',
          content:
            'You select which files are most likely to reveal a codebase\'s house conventions ' +
            '(naming, error handling, module structure, testing patterns). Prefer files that look ' +
            'representative, not one-off scripts or generated code.',
        },
        {
          role: 'user',
          content: `Candidate files (top-ranked by import centrality):\n${samples.join('\n')}\n\nPick up to ${MAX_SELECTED_FILES} worth reading in full.`,
        },
      ],
    });

    const selected = selection.data.files
      .filter((f) => samples.includes(f))
      .slice(0, MAX_SELECTED_FILES);
    if (selected.length === 0) {
      logger?.warn(
        { repoId, workspaceId, offered: samples.length, modelReturned: selection.data.files.length },
        'conventions.extract: model selected no files that were actually offered — dropping the response',
      );
      return this.list(workspaceId, repoId);
    }

    const files = await this.container.repoIntel.readFiles(repoId, selected);
    if (files.length === 0) {
      logger?.warn(
        { repoId, workspaceId, selected },
        'conventions.extract: none of the selected files were readable from the clone',
      );
      return this.list(workspaceId, repoId);
    }

    const filesBlock = files
      .map((f) => `### ${f.path}\n${f.content.slice(0, MAX_FILE_CHARS)}`)
      .join('\n\n');

    const extraction = await llm.completeStructured({
      model,
      schema: ConventionExtractionSchema,
      schemaName: 'ConventionExtraction',
      messages: [
        {
          role: 'system',
          content:
            'You extract concrete, enforceable house conventions from source code — naming rules, ' +
            'error-handling patterns, module boundaries, testing conventions. Each candidate must cite ' +
            'the exact file and a short code snippet as evidence. Do not invent conventions you cannot ' +
            'point to in the given files.',
        },
        { role: 'user', content: filesBlock },
      ],
    });

    const candidates = extraction.data.candidates.slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) {
      logger?.warn(
        { repoId, workspaceId, filesRead: files.length },
        'conventions.extract: model extracted zero rule candidates from the read files',
      );
    }

    await this.repo.replaceUnaccepted(
      workspaceId,
      repoId,
      candidates.map((c) => ({
        workspaceId,
        repoId,
        rule: c.rule,
        evidencePath: c.evidence_path,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
      })),
    );

    return this.list(workspaceId, repoId);
  }
}
