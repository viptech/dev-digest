import { stringify as stringifyYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import type { AgentManifestInput, CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import type { AgentRow, SkillRow } from '../../db/rows.js';
import type { LinkedSkillRow } from '../agents/repository.js';

/**
 * ci module — manifest building (SPEC-08 T3, AC-8/AC-9).
 *
 * Builds the `AgentManifest` the studio writes to
 * `.devdigest/agents/<slug>.yaml` and serializes it to YAML. Both the slug
 * computation and the YAML serializer are pure functions — no I/O, no
 * container — matching the onion-architecture rule that this file only
 * transforms already-loaded rows into the shared contract shape.
 *
 * `agent-runner/src/manifest.ts` reads the YAML this produces back with the
 * generic `yaml` npm package + `AgentManifest.safeParse` (round-trip, AC-8).
 * Coordinator note: an earlier revision of this file hand-wrote its own YAML
 * serializer (block-scalar `system_prompt`, JSON-string-as-double-quoted-
 * scalar for the rest) to avoid adding a `server/package.json` dependency
 * from a session without `Bash`. That serializer had a real round-trip gap —
 * `|` (clip) block-scalar chomping strips trailing blank lines, so a
 * `system_prompt` ending in blank lines would not survive
 * write→parse→`AgentManifest.safeParse` unchanged (AC-8) — and duplicated
 * escaping logic the `yaml` package (already a direct `agent-runner`
 * dependency, same major version) gets right by construction. Replaced with
 * the real library on both ends instead of maintaining a parallel
 * hand-rolled writer.
 */

// ---------------------------------------------------------------------------
// Slug computation (AC-9) — never persisted, recomputed on every export.
// ---------------------------------------------------------------------------

/** kebab-case a display name for use as a file-path segment. Strips anything
 *  outside `[a-z0-9-]` (Untrusted-inputs note: `agents.name`/`skills.name`
 *  are trusted studio content, but the slug still becomes part of a
 *  `commitFiles` path, so this is a cheap belt-and-suspenders sanitize, not
 *  an injection defense). Never returns an empty string. */
const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '') // strip combining diacritics left behind by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : 'item';
}

/**
 * Slugify a list of named items, de-duplicating collisions within THIS list
 * only (AC-9's "within one export" scope) by appending `-2`, `-3`, … to the
 * base slug in list order. Returns a Map keyed by the item's own `id` so
 * callers can look up "this skill's slug" without re-deriving it.
 */
export function dedupeSlugs(items: { id: string; name: string }[]): Map<string, string> {
  const seenCount = new Map<string, number>();
  const slugById = new Map<string, string>();
  for (const item of items) {
    const base = slugify(item.name);
    const count = seenCount.get(base) ?? 0;
    seenCount.set(base, count + 1);
    slugById.set(item.id, count === 0 ? base : `${base}-${count + 1}`);
  }
  return slugById;
}

// ---------------------------------------------------------------------------
// Manifest building (AC-8)
// ---------------------------------------------------------------------------

export interface ManifestSkillFile {
  id: string;
  slug: string;
  name: string;
  body: string;
}

export interface BuiltAgentManifest {
  agentSlug: string;
  /** Already round-tripped through `AgentManifest.parse` — defaults applied,
   *  guaranteed to satisfy the same Zod contract `agent-runner` validates
   *  against on read (AC-8). */
  manifest: AgentManifest;
  /** Enabled + linked skills only, in link order, each with its computed
   *  slug (AC-9) — empty when the agent has none (Edge cases: 4-file export). */
  skills: ManifestSkillFile[];
}

/**
 * Build the `AgentManifest` + resolved skill-file list for one agent.
 * `linkedSkills` is the agent's full linked-skill list (any order/enabled
 * state) — this function does the enabled-filtering itself (mirrors
 * `run-executor.ts`'s "resolve linked skills, filter by enabled" rule, see
 * `server/INSIGHTS.md` 2026-08-02 fix entry) so callers never have to
 * remember to filter before calling in.
 */
export function buildAgentManifest(agent: AgentRow, linkedSkills: LinkedSkillRow[]): BuiltAgentManifest {
  const enabledSkills: SkillRow[] = linkedSkills.filter((l) => l.skill.enabled).map((l) => l.skill);
  const slugById = dedupeSlugs(enabledSkills.map((s) => ({ id: s.id, name: s.name })));
  const skills: ManifestSkillFile[] = enabledSkills.map((s) => ({
    id: s.id,
    slug: slugById.get(s.id)!,
    name: s.name,
    body: s.body,
  }));

  const input: AgentManifestInput = {
    name: agent.name,
    provider: agent.provider as Provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: skills.map((s) => s.slug),
    strategy: agent.strategy as ReviewStrategy,
    ci_fail_on: agent.ciFailOn as CiFailOn,
  };

  // Round-trip through the shared contract itself — the object we go on to
  // serialize is exactly what `.safeParse` on the agent-runner side accepts.
  const manifest = AgentManifest.parse(input);

  return { agentSlug: slugify(agent.name), manifest, skills };
}

// ---------------------------------------------------------------------------
// YAML serialization (AC-8)
// ---------------------------------------------------------------------------

/** Serialize a validated `AgentManifest` to YAML matching the shape
 *  `agent-runner/src/manifest.ts`'s `parseYaml` + `AgentManifest.safeParse`
 *  expects on read (AC-8). Field order matches the manifest's own key order
 *  for a stable, human-reviewable diff across re-exports; `system_prompt`
 *  gets the library's own multiline handling (block scalar when it's safe,
 *  quoted otherwise) rather than a hand-picked style. */
export function serializeManifestYaml(manifest: AgentManifest): string {
  return stringifyYaml(
    {
      name: manifest.name,
      provider: manifest.provider,
      model: manifest.model,
      system_prompt: manifest.system_prompt,
      skills: manifest.skills,
      strategy: manifest.strategy,
      ci_fail_on: manifest.ci_fail_on,
    },
    { lineWidth: 0 },
  );
}
