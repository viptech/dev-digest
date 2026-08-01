import { describe, it, expect } from 'vitest';
import { parseMarkdownImport } from '../src/modules/skills/helpers.js';

describe('parseMarkdownImport', () => {
  it('extracts name from the first H1 and description from the first paragraph', () => {
    const md = `# PR Quality Rubric

Check that every PR has a clear intent statement and a test for the happy
path plus at least one edge case.

## Details
- rule 1
- rule 2`;
    const result = parseMarkdownImport(md);
    expect(result.name).toBe('PR Quality Rubric');
    expect(result.description).toBe(
      'Check that every PR has a clear intent statement and a test for the happy path plus at least one edge case.',
    );
    expect(result.body).toBe(md);
  });

  it('falls back to empty name/description when there is no H1 or paragraph', () => {
    const md = `- just a list\n- no heading`;
    const result = parseMarkdownImport(md);
    expect(result.name).toBe('');
    expect(result.description).toBe('');
    expect(result.body).toBe(md);
  });

  it('collapses a multi-line first paragraph into one description line', () => {
    const md = `# Api Contract Change

Flag any PR that changes the signature of an exported\nroute handler without a version bump.

More detail below.`;
    const result = parseMarkdownImport(md);
    expect(result.description).toBe(
      'Flag any PR that changes the signature of an exported route handler without a version bump.',
    );
  });
});
