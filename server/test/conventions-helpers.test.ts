import { describe, it, expect } from 'vitest';
import { toConventionDto } from '../src/modules/conventions/helpers.js';
import type { ConventionRow } from '../src/modules/conventions/repository.js';

describe('toConventionDto', () => {
  it('maps a full row', () => {
    const row: ConventionRow = {
      id: 'c1',
      workspaceId: 'w1',
      repoId: 'r1',
      rule: 'Use snake_case for wire contracts',
      evidencePath: 'server/src/vendor/shared/contracts/platform.ts',
      evidenceSnippet: 'head_sha: text(...)',
      confidence: 0.82,
      accepted: false,
    };
    expect(toConventionDto(row)).toEqual({
      id: 'c1',
      rule: 'Use snake_case for wire contracts',
      evidence_path: 'server/src/vendor/shared/contracts/platform.ts',
      evidence_snippet: 'head_sha: text(...)',
      confidence: 0.82,
      accepted: false,
    });
  });

  it('maps null evidence/confidence to null, not undefined', () => {
    const row: ConventionRow = {
      id: 'c2',
      workspaceId: 'w1',
      repoId: 'r1',
      rule: 'No default exports',
      evidencePath: null,
      evidenceSnippet: null,
      confidence: null,
      accepted: true,
    };
    const dto = toConventionDto(row);
    expect(dto.evidence_path).toBeNull();
    expect(dto.confidence).toBeNull();
  });
});
