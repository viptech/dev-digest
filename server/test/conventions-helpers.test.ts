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
      category: 'naming',
      evidencePath: 'server/src/vendor/shared/contracts/platform.ts',
      evidenceSnippet: 'head_sha: text(...)',
      evidenceLine: 42,
      confidence: 0.82,
      accepted: true,
      status: 'accepted',
    };
    expect(toConventionDto(row)).toEqual({
      id: 'c1',
      rule: 'Use snake_case for wire contracts',
      category: 'naming',
      evidence_path: 'server/src/vendor/shared/contracts/platform.ts',
      evidence_snippet: 'head_sha: text(...)',
      evidence_line: 42,
      confidence: 0.82,
      accepted: true,
      status: 'accepted',
    });
  });

  it('maps null evidence/confidence to null, not undefined', () => {
    const row: ConventionRow = {
      id: 'c2',
      workspaceId: 'w1',
      repoId: 'r1',
      rule: 'No default exports',
      category: 'structure',
      evidencePath: null,
      evidenceSnippet: null,
      evidenceLine: null,
      confidence: null,
      accepted: false,
      status: 'pending',
    };
    const dto = toConventionDto(row);
    expect(dto.evidence_path).toBeNull();
    expect(dto.evidence_line).toBeNull();
    expect(dto.confidence).toBeNull();
    expect(dto.accepted).toBe(false);
    expect(dto.status).toBe('pending');
  });
});
