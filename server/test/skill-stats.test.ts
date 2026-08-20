import { describe, it, expect } from 'vitest';
import { computeSkillStats } from '../src/modules/skills/stats-helpers.js';

const BASE_RUN = {
  id: 'r1',
  agentId: 'a1',
  costUsd: 0.1,
  findingsCount: 2,
  skillIds: ['s1'],
};

describe('computeSkillStats', () => {
  it('AC-27: never-linked skill returns an empty/zero state, no failing query', () => {
    const stats = computeSkillStats({
      skillId: 's1',
      skillName: 'Corner Cases',
      agentIds: [],
      agentNames: new Map(),
      runs: [],
      findings: [],
    });
    expect(stats.used_by_agents).toBe(0);
    expect(stats.pull_rate).toBeNull();
    expect(stats.accept_rate).toBeNull();
    expect(stats.agents).toEqual([]);
    expect(stats.cost_by_category).toEqual([]);
  });

  it('AC-24: pull_rate is null (not 0%) when the linking agents have no done runs in the window', () => {
    const stats = computeSkillStats({
      skillId: 's1',
      skillName: 'Corner Cases',
      agentIds: ['a1'],
      agentNames: new Map([['a1', 'Reviewer']]),
      runs: [],
      findings: [],
    });
    expect(stats.used_by_agents).toBe(1);
    expect(stats.pull_rate).toBeNull();
    expect(stats.agents).toEqual([{ agent_id: 'a1', agent_name: 'Reviewer', pull_rate: null }]);
  });

  it('AC-23/AC-24: used_by_agents counts distinct linking agents; pull_rate is numerator/denominator over their done runs', () => {
    const stats = computeSkillStats({
      skillId: 's1',
      skillName: 'Corner Cases',
      agentIds: ['a1', 'a2'],
      agentNames: new Map([['a1', 'Reviewer'], ['a2', 'Style Bot']]),
      runs: [
        { ...BASE_RUN, id: 'r1', agentId: 'a1', skillIds: ['s1'] }, // pulled
        { ...BASE_RUN, id: 'r2', agentId: 'a1', skillIds: [] }, // did not pull
        { ...BASE_RUN, id: 'r3', agentId: 'a2', skillIds: ['s1'] }, // pulled
      ],
      findings: [],
    });
    expect(stats.used_by_agents).toBe(2);
    expect(stats.pull_rate).toBeCloseTo(2 / 3); // 2 pulled / 3 total done runs
    expect(stats.agents).toEqual(
      expect.arrayContaining([
        { agent_id: 'a1', agent_name: 'Reviewer', pull_rate: 0.5 }, // 1/2
        { agent_id: 'a2', agent_name: 'Style Bot', pull_rate: 1 }, // 1/1
      ]),
    );
  });

  it('AC-25: accept_rate is vacuous null (not 0) when no finding in the pulled set has a decision', () => {
    const stats = computeSkillStats({
      skillId: 's1',
      skillName: 'Corner Cases',
      agentIds: ['a1'],
      agentNames: new Map([['a1', 'Reviewer']]),
      runs: [BASE_RUN],
      findings: [{ runId: 'r1', category: 'security', acceptedAt: null, dismissedAt: null }],
    });
    expect(stats.accept_rate).toBeNull();
  });

  it('AC-25: accept_rate = accepted / (accepted + dismissed), excluding pending findings', () => {
    const stats = computeSkillStats({
      skillId: 's1',
      skillName: 'Corner Cases',
      agentIds: ['a1'],
      agentNames: new Map([['a1', 'Reviewer']]),
      runs: [BASE_RUN],
      findings: [
        { runId: 'r1', category: 'security', acceptedAt: new Date(), dismissedAt: null },
        { runId: 'r1', category: 'bug', acceptedAt: null, dismissedAt: new Date() },
        { runId: 'r1', category: 'style', acceptedAt: null, dismissedAt: null }, // pending, excluded
      ],
    });
    expect(stats.accept_rate).toBeCloseTo(0.5);
  });

  it('AC-26: splits a run cost evenly across its own findings, summed per category', () => {
    const stats = computeSkillStats({
      skillId: 's1',
      skillName: 'Corner Cases',
      agentIds: ['a1'],
      agentNames: new Map([['a1', 'Reviewer']]),
      runs: [{ ...BASE_RUN, id: 'r1', costUsd: 1, findingsCount: 4, skillIds: ['s1'] }],
      findings: [
        { runId: 'r1', category: 'security', acceptedAt: null, dismissedAt: null },
        { runId: 'r1', category: 'security', acceptedAt: null, dismissedAt: null },
        { runId: 'r1', category: 'perf', acceptedAt: null, dismissedAt: null },
        { runId: 'r1', category: 'perf', acceptedAt: null, dismissedAt: null },
      ],
    });
    // $1 / 4 findings = $0.25 each; 2 findings per category = $0.50 each.
    expect(stats.cost_by_category).toEqual(
      expect.arrayContaining([
        { category: 'security', cost_usd: 0.5 },
        { category: 'perf', cost_usd: 0.5 },
      ]),
    );
    const total = stats.cost_by_category.reduce((sum, c) => sum + c.cost_usd, 0);
    expect(total).toBeCloseTo(1); // category sums equal the run's actual cost, no over/under-attribution
  });

  it('AC-26: a run with costUsd === null or findingsCount === 0 contributes nothing (no NaN, no divide-by-zero)', () => {
    const stats = computeSkillStats({
      skillId: 's1',
      skillName: 'Corner Cases',
      agentIds: ['a1'],
      agentNames: new Map([['a1', 'Reviewer']]),
      runs: [
        { ...BASE_RUN, id: 'r1', costUsd: null, findingsCount: 2, skillIds: ['s1'] },
        { ...BASE_RUN, id: 'r2', costUsd: 0.5, findingsCount: 0, skillIds: ['s1'] },
      ],
      findings: [
        { runId: 'r1', category: 'security', acceptedAt: null, dismissedAt: null },
        { runId: 'r2', category: 'security', acceptedAt: null, dismissedAt: null },
      ],
    });
    expect(stats.cost_by_category).toEqual([]);
    for (const c of stats.cost_by_category) {
      expect(Number.isNaN(c.cost_usd)).toBe(false);
    }
  });

  it('AC-26: does NOT attribute the full run cost to every represented category (rejected alternative)', () => {
    const stats = computeSkillStats({
      skillId: 's1',
      skillName: 'Corner Cases',
      agentIds: ['a1'],
      agentNames: new Map([['a1', 'Reviewer']]),
      runs: [{ ...BASE_RUN, id: 'r1', costUsd: 1, findingsCount: 2, skillIds: ['s1'] }],
      findings: [
        { runId: 'r1', category: 'security', acceptedAt: null, dismissedAt: null },
        { runId: 'r1', category: 'perf', acceptedAt: null, dismissedAt: null },
      ],
    });
    const total = stats.cost_by_category.reduce((sum, c) => sum + c.cost_usd, 0);
    // Rejected alternative would sum to $2 (full $1 to each of 2 categories).
    expect(total).toBeCloseTo(1);
  });
});
