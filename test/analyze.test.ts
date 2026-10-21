import { describe, expect, it } from 'vitest';
import { zeroCost, zeroUsage } from '../shared/pricing';
import type { Prompt, SessionDetail, Step } from '../shared/types';
import { buildAnalysis, DEFAULT_ANALYZE } from '../src/lib/analyze';

function step(cost: number, tools: Step['tools'] = []): Step {
  return {
    id: `s${cost}`,
    ts: '2026-10-01T10:00:00.000Z',
    model: 'claude-opus-5-5',
    speed: 'standard',
    usage: { ...zeroUsage(), cacheRead: 100_000, output: 1000 },
    cost: { ...zeroCost(), cacheRead: cost * 0.6, output: cost * 0.4, total: cost },
    contextTokens: 100_000,
    tools,
    textPreview: '',
    hasThinking: false,
    stopReason: 'tool_use',
    cacheRebuild: false,
    gapMinutes: null,
  };
}

function prompt(index: number, text: string, cost: number): Prompt {
  const s = step(cost, [{ id: `t${index}`, name: 'Read', summary: '/Users/someone/project/src/secret.ts', resultChars: 100, isError: false, carryCost: 0 }]);
  return {
    id: `p${index}`,
    index,
    ts: s.ts,
    kind: 'prompt',
    text,
    imageCount: 0,
    steps: [s],
    subagents: [],
    usage: s.usage,
    cost: s.cost,
    ownCost: cost,
    durationMs: 1000,
    interrupted: false,
    toolCounts: { Read: 1 },
    peakContext: 100_000,
  };
}

const prompts = [prompt(1, 'cheap question', 0.1), prompt(2, 'refactor the auth module', 5), prompt(3, 'another cheap one', 0.2)];
const session: SessionDetail = {
  id: 'abc',
  projectId: '-Users-someone-project',
  cwd: '/Users/someone/project',
  title: 'Auth refactor',
  firstPrompt: 'cheap question',
  start: '2026-10-01T10:00:00.000Z',
  end: '2026-10-01T11:00:00.000Z',
  activeMs: 3_600_000,
  promptCount: 3,
  stepCount: 3,
  usage: zeroUsage(),
  cost: { ...zeroCost(), total: 5.3 },
  costByModel: { 'claude-opus-5-5': 5.3 },
  models: ['claude-opus-5-5'],
  gitBranch: 'main',
  version: '2.1.300',
  subagentCount: 0,
  subagentCost: 0,
  compactions: 0,
  cacheRebuilds: 0,
  cacheRebuildCost: 0,
  peakContext: 100_000,
  reported: null,
  prLinks: [],
  isLive: false,
  fileBytes: 0,
  prompts,
  compactionEvents: [],
  insights: [{ id: 'x', severity: 'high', title: 'Big context', detail: 'Use /compact' }],
  toolStats: [{ name: 'Read', calls: 3, errors: 0, resultChars: 300, carryCost: 0 }],
};

describe('buildAnalysis', () => {
  it('includes instructions, totals, findings and every prompt', () => {
    const t = buildAnalysis(session, DEFAULT_ANALYZE);
    expect(t).toContain('Where did the money go?');
    expect(t).toContain('Estimated cost: $5.30');
    expect(t).toContain('[high] Big context');
    expect(t).toContain('### #1');
    expect(t).toContain('### #3');
    expect(t).toContain('refactor the auth module');
  });

  it('masks the home directory and omits prompt text when asked', () => {
    const t = buildAnalysis(session, { ...DEFAULT_ANALYZE, includePromptText: false });
    expect(t).not.toContain('/Users/someone');
    expect(t).toContain('~/project');
    expect(t).not.toContain('refactor the auth module');
  });

  it('keeps only the most expensive prompts, in session order', () => {
    const t = buildAnalysis(session, { ...DEFAULT_ANALYZE, promptLimit: 2 });
    expect(t).not.toContain('### #1');
    expect(t.indexOf('### #2')).toBeLessThan(t.indexOf('### #3'));
  });

  it('drops tool details when asked', () => {
    const t = buildAnalysis(session, { ...DEFAULT_ANALYZE, includeToolDetails: false });
    expect(t).not.toContain('secret.ts');
  });
});
