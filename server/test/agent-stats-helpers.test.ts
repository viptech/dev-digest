import { describe, it, expect } from 'vitest';
import { computeAgentStats } from '../src/modules/agents/stats-helpers.js';

const BASE_RUN = {
  id: 'r1',
  ranAt: new Date('2026-07-01T00:00:00Z'),
  durationMs: 4000,
  tokensIn: 1000,
  tokensOut: 200,
  costUsd: 0.04,
  findingsCount: 2,
  skillIds: ['s1'],
  prNumber: 482,
  source: 'local' as const,
};

describe('computeAgentStats', () => {
  it('returns zeroed/null stats for no runs', () => {
    const stats = computeAgentStats({ agentId: 'a1', agentName: 'Agent', runs: [], findings: [], skillNames: new Map() });
    expect(stats.runs).toBe(0);
    expect(stats.accept_rate).toBeNull();
    expect(stats.avg_cost_usd).toBeNull();
    expect(stats.most_used_skills).toEqual([]);
    expect(stats.run_history).toEqual([]);
  });

  it('computes avg cost/latency and run_history from runs', () => {
    const stats = computeAgentStats({
      agentId: 'a1',
      agentName: 'Agent',
      runs: [BASE_RUN, { ...BASE_RUN, id: 'r2', costUsd: 0.06, durationMs: 6000, skillIds: [] }],
      findings: [],
      skillNames: new Map([['s1', 'Corner Cases']]),
    });
    expect(stats.runs).toBe(2);
    expect(stats.avg_cost_usd).toBeCloseTo(0.05);
    expect(stats.avg_latency_ms).toBe(5000);
    expect(stats.run_history).toHaveLength(2);
    expect(stats.run_history[0]!.pr_number).toBe(482);
  });

  it('computes accept_rate only over findings with a verdict (accepted or dismissed)', () => {
    const stats = computeAgentStats({
      agentId: 'a1',
      agentName: 'Agent',
      runs: [BASE_RUN],
      findings: [
        { severity: 'CRITICAL', category: 'security', acceptedAt: new Date(), dismissedAt: null },
        { severity: 'WARNING', category: 'bug', acceptedAt: null, dismissedAt: new Date() },
        { severity: 'SUGGESTION', category: 'style', acceptedAt: null, dismissedAt: null }, // pending, excluded from the rate
      ],
      skillNames: new Map(),
    });
    expect(stats.accepted).toBe(1);
    expect(stats.dismissed).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.accept_rate).toBeCloseTo(0.5); // 1 accepted / (1 accepted + 1 dismissed)
    expect(stats.findings_total).toBe(3);
  });

  it('groups findings_by_severity and findings_by_category', () => {
    const stats = computeAgentStats({
      agentId: 'a1',
      agentName: 'Agent',
      runs: [BASE_RUN],
      findings: [
        { severity: 'CRITICAL', category: 'security', acceptedAt: null, dismissedAt: null },
        { severity: 'CRITICAL', category: 'security', acceptedAt: null, dismissedAt: null },
        { severity: 'WARNING', category: 'perf', acceptedAt: null, dismissedAt: null },
      ],
      skillNames: new Map(),
    });
    expect(stats.findings_by_severity).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });
    expect(stats.findings_by_category).toEqual(
      expect.arrayContaining([
        { category: 'security', count: 2 },
        { category: 'perf', count: 1 },
      ]),
    );
  });

  it('computes most_used_skills as the fraction of runs using each skill, sorted descending, top 5', () => {
    const runs = [
      { ...BASE_RUN, id: 'r1', skillIds: ['s1', 's2'] },
      { ...BASE_RUN, id: 'r2', skillIds: ['s1'] },
      { ...BASE_RUN, id: 'r3', skillIds: [] },
      { ...BASE_RUN, id: 'r4', skillIds: null },
    ];
    const stats = computeAgentStats({
      agentId: 'a1',
      agentName: 'Agent',
      runs,
      findings: [],
      skillNames: new Map([['s1', 'Corner Cases'], ['s2', 'Api Contract']]),
    });
    expect(stats.most_used_skills[0]).toEqual({ skill_id: 's1', name: 'Corner Cases', pct: 0.5 });
    expect(stats.most_used_skills[1]).toEqual({ skill_id: 's2', name: 'Api Contract', pct: 0.25 });
  });

  it('dedupes duplicate skill ids within a single run so pct never exceeds 1', () => {
    const runs = [
      { ...BASE_RUN, id: 'r1', skillIds: ['s1', 's1'] },
      { ...BASE_RUN, id: 'r2', skillIds: ['s1'] },
    ];
    const stats = computeAgentStats({
      agentId: 'a1',
      agentName: 'Agent',
      runs,
      findings: [],
      skillNames: new Map([['s1', 'Corner Cases']]),
    });
    // Both runs used s1 once each (duplicate mention within r1 must not double-count) -> 2/2 = 1.
    expect(stats.most_used_skills[0]).toEqual({ skill_id: 's1', name: 'Corner Cases', pct: 1 });
    expect(stats.most_used_skills[0]!.pct).toBeLessThanOrEqual(1);
  });
});
