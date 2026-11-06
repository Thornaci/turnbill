import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSession } from '../server/parser';
import { Store } from '../server/store';
import { normalizeModelId, priceRequest, zeroUsage } from '../shared/pricing';

const CWD = '/tmp/fb';
let n = 0;
const uid = () => `x${++n}`;
const ts = (m: number) => new Date(Date.UTC(2026, 9, 2, 9, 0, 0) + m * 60_000).toISOString();

function it_(o: { model?: string; type: string; input?: number; read?: number; w1h?: number; out?: number }) {
  return {
    type: o.type,
    ...(o.model ? { model: o.model } : {}),
    input_tokens: o.input ?? 2,
    cache_read_input_tokens: o.read ?? 0,
    cache_creation_input_tokens: o.w1h ?? 0,
    cache_creation: { ephemeral_1h_input_tokens: o.w1h ?? 0, ephemeral_5m_input_tokens: 0 },
    output_tokens: o.out ?? 0,
  };
}

function usage(top: ReturnType<typeof it_>, extra: Record<string, unknown> = {}) {
  const { type: _t, model: _m, ...rest } = top as any;
  return { ...rest, ...extra };
}

function asst(id: string, model: string, u: object, minute: number, extra: Record<string, unknown> = {}) {
  return { type: 'assistant', uuid: uid(), parentUuid: null, timestamp: ts(minute), cwd: CWD, ...extra, message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: u } };
}

function user(promptId: string, text: string, minute: number, extra: Record<string, unknown> = {}) {
  return { type: 'user', uuid: uid(), parentUuid: null, promptId, timestamp: ts(minute), cwd: CWD, message: { role: 'user', content: text }, ...extra };
}

async function session(lines: unknown[], subagents: Record<string, unknown[]> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'turnbill-fb-'));
  const dir = path.join(root, '-tmp-fb');
  await mkdir(path.join(dir, 's1', 'subagents'), { recursive: true });
  const main = path.join(dir, 's1.jsonl');
  await writeFile(main, lines.map((l) => JSON.stringify(l)).join('\n'));
  const subagentFiles = [];
  for (const [name, recs] of Object.entries(subagents)) {
    const file = path.join(dir, 's1', 'subagents', `agent-${name}.jsonl`);
    await writeFile(file, recs.map((l) => JSON.stringify(l)).join('\n'));
    subagentFiles.push({ file, metaFile: null });
  }
  return { root, detail: await parseSession({ id: 's1', projectId: '-tmp-fb', mainFile: main, subagentFiles }) };
}

describe('refusal fallbacks (usage.iterations)', () => {
  it('prices each attempt on its own model and applies the billing rules', async () => {
    const midStream = [it_({ type: 'message', model: 'claude-fable-5', w1h: 70_000, read: 20_000, out: 4 }), it_({ type: 'fallback_message', model: 'claude-opus-5', w1h: 48_000, read: 43_000, out: 1500 })];
    const cyber = [it_({ type: 'message', model: 'claude-fable-5', w1h: 60_000 }), it_({ type: 'fallback_message', model: 'claude-opus-4-8', w1h: 60_000, out: 2800 })];
    const bio = [it_({ type: 'message', model: 'claude-fable-5', w1h: 50_000 }), it_({ type: 'fallback_message', model: 'claude-opus-4-8', w1h: 50_000, out: 900 })];
    const { detail } = await session([
      user('p1', 'do it', 0, { origin: { kind: 'human' } }),
      // The first streamed line carries partial usage and no iterations; the last line has them.
      asst('m1', 'claude-opus-5', usage(midStream[1], { iterations: [] }), 0.1, { requestId: 'r1' }),
      asst('m1', 'claude-opus-5', usage(midStream[1], { iterations: midStream }), 0.2, { requestId: 'r1' }),
      asst('m2', 'claude-opus-4-8', usage(cyber[1], { iterations: cyber }), 1, { requestId: 'r2' }),
      { type: 'system', subtype: 'model_refusal_fallback', requestId: 'r2', apiRefusalCategory: 'cyber', uuid: uid(), timestamp: ts(1) },
      asst('m3', 'claude-opus-4-8', usage(bio[1], { iterations: bio }), 2, { requestId: 'r3' }),
      { type: 'system', subtype: 'model_refusal_fallback', requestId: 'r3', apiRefusalCategory: 'bio', uuid: uid(), timestamp: ts(2) },
    ]);
    const steps = detail.prompts[0].steps;
    expect(steps.map((s) => s.model)).toEqual(['claude-fable-5', 'claude-opus-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-fable-5', 'claude-opus-4-8']);
    const [mid, , cyb, , bi] = steps;
    expect(mid.refusal).toEqual({ category: null, billed: true, fallbackModel: 'claude-opus-5' });
    expect(mid.cost.total).toBeCloseTo(priceRequest('claude-fable-5', { ...zeroUsage(), input: 2, cacheRead: 20_000, cacheWrite1h: 70_000, output: 4 }).total, 10);
    expect(cyb.refusal).toEqual({ category: 'cyber', billed: false, fallbackModel: 'claude-opus-4-8' });
    expect(cyb.cost.total).toBe(0);
    expect(bi.refusal?.billed).toBe(true);
    expect(bi.cost.total).toBeGreaterThan(0);
    expect(detail.costByModel['claude-fable-5']).toBeCloseTo(mid.cost.total + bi.cost.total, 10);
    expect(detail.stepCount).toBe(6);
  });

  it('reads speed from the final streamed line', async () => {
    const top = it_({ type: 'message', read: 10_000, out: 1000 });
    const { detail } = await session([
      user('p1', 'go', 0, { origin: { kind: 'human' } }),
      asst('m1', 'claude-opus-5-5', usage(top), 0.1),
      asst('m1', 'claude-opus-5-5', usage(top, { speed: 'fast' }), 0.2),
    ]);
    const s = detail.prompts[0].steps[0];
    expect(s.speed).toBe('fast');
    expect(s.cost.output).toBeCloseTo((1000 * 40) / 1e6, 10);
  });
});

describe('prompt attribution', () => {
  it('splits a resumed subagent across the prompts that ran it', async () => {
    const u = usage(it_({ type: 'message', input: 1000, out: 100 }));
    const { detail } = await session(
      [
        user('p1', 'first', 0, { origin: { kind: 'human' } }),
        asst('m1', 'claude-opus-5-5', u, 0.1),
        user('p2', 'second', 10, { origin: { kind: 'human' } }),
        asst('m2', 'claude-opus-5-5', u, 10.1),
      ],
      {
        a1: [
          { type: 'user', uuid: 'su1', parentUuid: null, isSidechain: true, promptId: 'p1', timestamp: ts(0.2), message: { role: 'user', content: 'look' } },
          { type: 'assistant', uuid: 'sa1', parentUuid: 'su1', isSidechain: true, timestamp: ts(0.3), message: { id: 's1', model: 'claude-haiku-5-5', content: [], usage: u } },
          { type: 'user', uuid: 'su2', parentUuid: 'sa1', isSidechain: true, promptId: 'p2', timestamp: ts(10.2), message: { role: 'user', content: 'again' } },
          { type: 'assistant', uuid: 'sa2', parentUuid: 'su2', isSidechain: true, timestamp: ts(10.3), message: { id: 's2', model: 'claude-haiku-5-5', content: [], usage: u } },
          { type: 'assistant', uuid: 'sa3', parentUuid: 'sa2', isSidechain: true, timestamp: ts(10.4), message: { id: 's3', model: 'claude-haiku-5-5', content: [], usage: u } },
        ],
      },
    );
    expect(detail.prompts[0].subagents.map((r) => r.steps.length)).toEqual([1]);
    expect(detail.prompts[1].subagents.map((r) => r.steps.length)).toEqual([2]);
    expect(detail.subagentCount).toBe(1);
  });

  it('treats messages from other Claude sessions as background, not prompts', async () => {
    const u = usage(it_({ type: 'message', out: 10 }));
    const { detail } = await session([
      user('p1', 'real prompt', 0, { origin: { kind: 'human' } }),
      asst('m1', 'claude-opus-5-5', u, 0.1),
      user('p2', 'Another Claude session sent a message:\n<teammate-message teammate_id="planner">idle</teammate-message>', 5),
      asst('m2', 'claude-opus-5-5', u, 5.1),
    ]);
    expect(detail.prompts.map((p) => p.kind)).toEqual(['prompt', 'system']);
    expect(detail.prompts[1].text).toBe('Message from another Claude session (planner)');
    expect(detail.promptCount).toBe(1);
  });
});

describe('pricing ids and what-if', () => {
  it('normalizes Bedrock global and us-gov inference profiles', () => {
    expect(normalizeModelId('global.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('claude-sonnet-4-5');
    expect(normalizeModelId('us-gov.anthropic.claude-opus-4-5-20251101-v1:0')).toBe('claude-opus-4-5');
  });

  it('prices the overview what-if per request so the Haiku 5.5 long-prompt tier applies', async () => {
    const big = usage(it_({ type: 'message', read: 150_000, out: 1000 }));
    const { root } = await session([user('p1', 'go', 0, { origin: { kind: 'human' } }), asst('m1', 'claude-opus-5-5', big, 0.1)]);
    const store = new Store(root);
    await store.refresh(true);
    const haiku = store.overview({ from: null, to: null }).whatIf.find((w) => w.id === 'claude-haiku-5-5')!;
    expect(haiku.cost).toBeCloseTo((150_000 * 0.05 + 2 * 0.5 + 1000 * 2.5) / 1e6, 10);
  });

  it('reports range-bounded first and last activity for sessions', async () => {
    const u = usage(it_({ type: 'message', out: 10 }));
    const { root } = await session([user('p1', 'a', 0, { origin: { kind: 'human' } }), asst('m1', 'claude-opus-5-5', u, 0.1), user('p2', 'b', 600, { origin: { kind: 'human' } }), asst('m2', 'claude-opus-5-5', u, 600.1)]);
    const store = new Store(root);
    await store.refresh(true);
    const [s] = store.sessions({ from: Date.parse(ts(300)), to: null });
    expect(s.start).toBe(ts(600.1));
  });
});
