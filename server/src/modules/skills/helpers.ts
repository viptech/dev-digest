import type { Skill, SkillType, SkillSource, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from './repository.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping and the
 * markdown-import parser. No I/O.
 */

export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Parse an imported markdown file into a create-candidate: `name` from the
 * first `# H1` heading (trimmed, empty string if none), `description` from
 * the first non-empty paragraph AFTER that heading (multi-line paragraphs are
 * collapsed to one line; empty string if none), and `body` = the WHOLE
 * original content, byte-for-byte — the skill's body is never mutated by
 * import, only name/description are derived as save-time suggestions the
 * user can edit before confirming.
 */
export function parseMarkdownImport(content: string): {
  name: string;
  description: string;
  body: string;
} {
  const lines = content.split('\n');
  let name = '';
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^#\s+(.+)$/.exec(lines[i]!.trim());
    if (m) {
      name = m[1]!.trim();
      headingIdx = i;
      break;
    }
  }

  let description = '';
  if (headingIdx >= 0) {
    const rest = lines.slice(headingIdx + 1);
    let start = -1;
    for (let i = 0; i < rest.length; i += 1) {
      const line = rest[i]!.trim();
      if (line.length === 0) continue;
      if (line.startsWith('#')) break; // hit the next heading before any paragraph
      start = i;
      break;
    }
    if (start >= 0) {
      const paragraphLines: string[] = [];
      for (let i = start; i < rest.length; i += 1) {
        const line = rest[i]!.trim();
        if (line.length === 0) break;
        paragraphLines.push(line);
      }
      description = paragraphLines.join(' ').trim();
    }
  }

  return { name, description, body: content };
}
