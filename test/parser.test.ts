import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { sessionInsights } from '../server/insights';
import { parseSession, rebuildPremium } from '../server/parser';
import { Store } from '../server/store';
import type { SessionDetail } from '../shared/types';

const SESSION = 'aaaaaaaa-1111-2222-3333-444444444444';
const PROJECT = '-tmp-demo';
const CWD = '/tmp/demo';

let uuid = 0;
const next = () => `u${++uuid}`;

function at(minutes: number) {
  return new Date(Date.UTC(2026, 9, 1, 10, 0, 0) + minutes * 60_000).toISOString();
}

function usage(o: { input?: number; read?: number; w1h?: number; w5m?: number; out?: number }) {
  return {
    input_tokens: o.input ?? 2,
    cache_read_input_tokens: o.read ?? 0,
    cache_creation_input_tokens: (o.w1h ?? 0) + (o.w5m ?? 0),
    cache_creation: { ephemeral_1h_input_tokens: o.w1h ?? 0, ephemeral_5m_input_tokens: o.w5m ?? 0 },
    output_tokens: o.out ?? 0,
    speed: 'standard',
    server_tool_use: { web_search_requests: 0 },
  };
}

function user(promptId: string | null, content: unknown, extra: Record<string, unknown> = {}, minute = 0) {
  return { type: 'user', uuid: next(), parentUuid: null, promptId, timestamp: at(minute), cwd: CWD, gitBranch: 'main', version: '2.1.300', message: { role: 'user', content }, ...extra };
}

function assistant(id: string, content: unknown[], u: ReturnType<typeof usage>, minute: number, parentUuid: string | null, model = 'claude-opus-5-5') {
  return { type: 'assistant', uuid: next(), parentUuid, timestamp: at(minute), cwd: CWD, message: { id, model, role: 'assistant', content, usage: u, stop_reason: 'tool_use' } };
}

function buildMain(): unknown[] {
  const recs: unknown[] = [];
  const p1 = user('p1', 'Fix the login bug', { origin: { kind: 'human' }, promptSource: 'typed' }, 0);
  recs.push(p1);
  // One API request split over three lines; usage on the first line is partial.
  const a1 = assistant('msg_1', [{ type: 'thinking', thinking: '' }], usage({ read: 20_000, w1h: 30_000, out: 3 }), 0.1, (p1 as any).uuid);
  const a1b = assistant('msg_1', [{ type: 'text', text: 'Looking at the auth module.' }], usage({ read: 20_000, w1h: 30_000, out: 400 }), 0.2, (a1 as any).uuid);
  const a1c = assistant('msg_1', [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: `${CWD}/src/auth.ts` } }], usage({ read: 20_000, w1h: 30_000, out: 400 }), 0.3, (a1b as any).uuid);
  recs.push(a1, a1b, a1c);
  const r1 = user('p1', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x'.repeat(35_000) }], {}, 0.4);
  (r1 as any).parentUuid = (a1c as any).uuid;
  recs.push(r1);
  const a2 = assistant('msg_2', [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'npm test' } }], usage({ read: 50_000, w1h: 10_000, out: 200 }), 0.5, (r1 as any).uuid);
  recs.push(a2);
  const r2 = user('p1', [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'failed', is_error: true }], {}, 0.6);
  recs.push(r2);
  const a3 = assistant('msg_3', [{ type: 'text', text: 'Fixed.' }], usage({ read: 60_000, w1h: 500, out: 100 }), 1, (r2 as any).uuid);
  recs.push(a3);
  recs.push({ type: 'system', subtype: 'turn_duration', durationMs: 61_000, uuid: next(), parentUuid: (a3 as any).uuid, timestamp: at(1.1) });
  recs.push({ type: 'assistant', uuid: next(), parentUuid: null, timestamp: at(1.2), message: { id: 'synthetic', model: '<synthetic>', content: [], usage: usage({ out: 5 }) } });

  // Slash command, then a background notification.
  recs.push(user('p2', '<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>auth</command-args>', { origin: { kind: 'human' } }, 2));
  const a4 = assistant('msg_4', [{ type: 'tool_use', id: 'toolu_3', name: 'Agent', input: { subagent_type: 'Explore', description: 'Find callers' } }], usage({ read: 60_000, w1h: 1_000, out: 300 }), 2.1, null);
  recs.push(a4);
  recs.push(user('p3', '<task-notification><summary>Build finished</summary></task-notification>', { origin: { kind: 'task-notification' } }, 3));
  recs.push(assistant('msg_5', [{ type: 'text', text: 'Build ok' }], usage({ read: 61_000, w1h: 200, out: 50 }), 3.1, null));

  // Two hours later: the 1h cache has expired, so the next request re-writes everything.
  recs.push(user('p4', 'Now add a test', { origin: { kind: 'human' } }, 125));
  recs.push(assistant('msg_6', [{ type: 'text', text: 'Adding.' }], usage({ read: 0, w1h: 62_000, out: 800 }), 125.2, null));
  recs.push(user('p4', [{ type: 'text', text: '[Request interrupted by user]' }], {}, 126));

  // Compaction resets the context.
  recs.push({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 62_800 }, uuid: next(), parentUuid: null, timestamp: at(127) });
  recs.push(user('p5', 'This session is being continued from a previous conversation…', { isCompactSummary: true }, 127));
  recs.push(assistant('msg_7', [{ type: 'text', text: 'Continuing.' }], usage({ read: 18_000, w1h: 25_000, out: 100 }), 127.5, null));

  recs.push({ type: 'ai-title', aiTitle: 'Login bug fix', sessionId: SESSION });
  recs.push({ type: 'cost-state', sessionId: SESSION, totalCostUSD: 1.5, startTime: Date.parse(at(120)), modelUsage: { 'claude-opus-5-5': { costUSD: 1.5 } } });
  return recs;
}

function buildSubagent(): unknown[] {
  const first = { type: 'user', uuid: next(), parentUuid: null, isSidechain: true, promptId: 'p2', agentId: 'aexplore', timestamp: at(2.2), message: { role: 'user', content: 'Find callers of login()' } };
  return [
    first,
    { type: 'assistant', uuid: next(), parentUuid: first.uuid, isSidechain: true, timestamp: at(2.3), message: { id: 'sub_1', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: 'toolu_s1', name: 'Grep', input: { pattern: 'login\\(', path: `${CWD}/src` } }], usage: usage({ input: 5_000, out: 100 }) } },
    { type: 'assistant', uuid: next(), parentUuid: null, isSidechain: true, timestamp: at(2.4), message: { id: 'sub_2', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Found 3' }], usage: usage({ input: 6_000, out: 50 }) } },
  ];
}

let root: string;
let detail: SessionDetail;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'turnbill-'));
  const dir = path.join(root, PROJECT);
  const subDir = path.join(dir, SESSION, 'subagents');
  await mkdir(subDir, { recursive: true });
  const toJsonl = (rs: unknown[]) => rs.map((r) => JSON.stringify(r)).join('\n') + '\n{"type":"assistant","trunc';
  await writeFile(path.join(dir, `${SESSION}.jsonl`), toJsonl(buildMain()));
  await writeFile(path.join(subDir, 'agent-aexplore.jsonl'), toJsonl(buildSubagent()));
  await writeFile(path.join(subDir, 'agent-aexplore.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find callers' }));
  // A session with no billable requests (e.g. opened and /clear-ed immediately).
  await writeFile(path.join(dir, 'bbbbbbbb-0000-0000-0000-000000000000.jsonl'), JSON.stringify(user(null, '<command-name>/clear</command-name>')) + '\n');

  detail = await parseSession({
    id: SESSION,
    projectId: PROJECT,
    mainFile: path.join(dir, `${SESSION}.jsonl`),
    subagentFiles: [{ file: path.join(subDir, 'agent-aexplore.jsonl'), metaFile: path.join(subDir, 'agent-aexplore.meta.json') }],
  });
});

describe('parseSession', () => {
  it('reads session metadata', () => {
    expect(detail.title).toBe('Login bug fix');
    expect(detail.cwd).toBe(CWD);
    expect(detail.gitBranch).toBe('main');
    expect(detail.compactions).toBe(1);
  });

  it('groups requests into prompts by promptId and classifies them', () => {
    expect(detail.prompts.map((p) => p.kind)).toEqual(['prompt', 'command', 'system', 'prompt', 'compact-summary']);
    expect(detail.prompts[1].text).toBe('/review auth');
    expect(detail.prompts[2].text).toBe('Background task notification: Build finished');
    expect(detail.promptCount).toBe(3);
  });

  it('deduplicates split assistant lines and keeps the final usage', () => {
    const p1 = detail.prompts[0];
    expect(p1.steps).toHaveLength(3);
    expect(p1.steps[0].usage.output).toBe(400);
    expect(p1.steps[0].hasThinking).toBe(true);
    expect(p1.steps[0].textPreview).toBe('Looking at the auth module.');
  });

  it('skips synthetic messages', () => {
    expect(detail.prompts.flatMap((p) => p.steps).some((s) => s.model === '<synthetic>')).toBe(false);
    expect(detail.stepCount).toBe(7 + 2);
  });

  it('attaches tool results and summarizes inputs', () => {
    const [read] = detail.prompts[0].steps[0].tools;
    expect(read.name).toBe('Read');
    expect(read.summary).toBe('src/auth.ts');
    expect(read.resultChars).toBe(35_000);
    expect(read.carryCost).toBeGreaterThan(0);
    const [bash] = detail.prompts[0].steps[1].tools;
    expect(bash.summary).toBe('npm test');
    expect(bash.isError).toBe(true);
  });

  it('uses recorded turn duration when present', () => {
    expect(detail.prompts[0].durationMs).toBe(61_000);
  });

  it('attributes subagent runs to the prompt that spawned them', () => {
    const p2 = detail.prompts[1];
    expect(p2.subagents).toHaveLength(1);
    expect(p2.subagents[0].agentType).toBe('Explore');
    expect(p2.subagents[0].steps).toHaveLength(2);
    expect(p2.cost.total).toBeCloseTo(p2.ownCost + p2.subagents[0].cost.total);
    expect(detail.subagentCost).toBeCloseTo(p2.subagents[0].cost.total);
  });

  it('flags cache rebuilds and infers the reason', () => {
    const rebuilt = detail.prompts[3].steps[0];
    expect(rebuilt.cacheRebuild).toBe(true);
    expect(rebuilt.rebuildReason).toBe('idle');
    expect(detail.prompts[3].interrupted).toBe(true);
    expect(detail.prompts[0].steps[0].rebuildReason).toBe('first');
    expect(detail.prompts[4].steps[0].rebuildReason).toBe('compaction');
    // Re-caching the compacted summary is unavoidable, so only the idle rebuild counts as extra.
    expect(rebuildPremium(detail.prompts[4].steps[0])).toBe(0);
    expect(detail.cacheRebuilds).toBe(1);
    expect(detail.cacheRebuildCost).toBeCloseTo(rebuildPremium(rebuilt), 10);
  });

  it('totals equal the sum of steps', () => {
    const steps = detail.prompts.flatMap((p) => [...p.steps, ...p.subagents.flatMap((r) => r.steps)]);
    expect(detail.cost.total).toBeCloseTo(steps.reduce((a, s) => a + s.cost.total, 0), 10);
    expect(Object.values(detail.costByModel).reduce((a, b) => a + b, 0)).toBeCloseTo(detail.cost.total, 10);
  });

  it('compares Claude Code reported cost over the same window', () => {
    expect(detail.reported?.totalUSD).toBe(1.5);
    const since = Date.parse(at(120));
    const expected = detail.prompts.flatMap((p) => p.steps).filter((s) => Date.parse(s.ts) >= since).reduce((a, s) => a + s.cost.total, 0);
    expect(detail.reported?.windowEstimate).toBeCloseTo(expected, 10);
  });

  it('ends the comparison window where the counter was written when the session was resumed later', async () => {
    // Counter written after the first prompt; everything after it belongs to a later run.
    const recs = buildMain().filter((r: any) => r.type !== 'cost-state');
    const cut = recs.findIndex((r: any) => r.type === 'system' && r.subtype === 'turn_duration') + 1;
    recs.splice(cut, 0, { type: 'cost-state', sessionId: SESSION, totalCostUSD: 1, startTime: Date.parse(at(0)) });
    const file = path.join(await mkdtemp(path.join(os.tmpdir(), 'turnbill-resumed-')), 'resumed.jsonl');
    await writeFile(file, recs.map((r) => JSON.stringify(r)).join('\n'));
    const d = await parseSession({ id: 'resumed', projectId: PROJECT, mainFile: file, subagentFiles: [] });
    expect(d.reported?.endTime).toBe(at(1.1));
    const firstRun = d.prompts[0].steps.reduce((a, s) => a + s.cost.total, 0);
    expect(d.reported?.windowEstimate).toBeCloseTo(firstRun, 10);
    expect(d.reported!.windowEstimate).toBeLessThan(d.cost.total);
    expect(d.reported?.comparable).toBe(true);
  });

  it('marks the counter as not comparable when the estimate for its window is higher', async () => {
    // A run that ended without saving the counter drops its cost, so the counter undercounts the window.
    const recs = buildMain().map((r: any) => (r.type === 'cost-state' ? { ...r, totalCostUSD: 0.01 } : r));
    const file = path.join(await mkdtemp(path.join(os.tmpdir(), 'turnbill-lost-run-')), 'lost.jsonl');
    await writeFile(file, recs.map((r) => JSON.stringify(r)).join('\n'));
    const d = await parseSession({ id: 'lost', projectId: PROJECT, mainFile: file, subagentFiles: [] });
    expect(d.reported?.comparable).toBe(false);
  });

  it('produces insights without throwing', () => {
    const insights = sessionInsights(detail);
    expect(Array.isArray(insights)).toBe(true);
  });
});

describe('Store', () => {
  it('lists projects with valid sessions only and filters by range', async () => {
    const store = new Store(root);
    await store.refresh(true);
    const projects = store.projects({ from: null, to: null });
    expect(projects).toHaveLength(1);
    expect(projects[0].path).toBe(CWD);
    expect(projects[0].sessionCount).toBe(1);
    expect(store.dataStatus().warnings.some((w) => w.includes('1 session file'))).toBe(true);

    const late = store.sessions({ from: Date.parse(at(120)), to: null });
    expect(late).toHaveLength(1);
    expect(late[0].stepCount).toBe(2);
    expect(late[0].cost.total).toBeLessThan(detail.cost.total);

    const o = store.overview({ from: null, to: null });
    expect(o.totals.cost.total).toBeCloseTo(detail.cost.total, 10);
    expect(o.daily.reduce((a, d) => a + d.total, 0)).toBeCloseTo(detail.cost.total, 10);
    expect(o.heatmap.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(detail.cost.total, 10);
  });

  it('finds prompts and tool calls in search', async () => {
    const store = new Store(root);
    await store.refresh(true);
    const hits = store.search('auth');
    expect(hits.some((h) => h.kind === 'prompt' && h.promptIndex === 2)).toBe(true);
    expect(hits.some((h) => h.kind === 'tool' && h.snippet.includes('src/auth.ts'))).toBe(true);
  });
});

describe('Store edge cases', () => {
  it('returns an empty project instead of 404 when the range has no activity', async () => {
    const store = new Store(root);
    await store.refresh(true);
    const r = store.project(PROJECT, { from: Date.parse('2030-01-01'), to: null });
    expect(r).not.toBeNull();
    expect(r!.project.sessionCount).toBe(0);
    expect(r!.sessions).toHaveLength(0);
    expect(store.project('-does-not-exist', { from: null, to: null })).toBeNull();
  });

  it('warns when the same API call appears in two transcripts', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'turnbill-dup-'));
    await mkdir(path.join(dir, PROJECT), { recursive: true });
    const lines = buildMain().map((r) => JSON.stringify(r)).join('\n');
    await writeFile(path.join(dir, PROJECT, 'one.jsonl'), lines);
    await writeFile(path.join(dir, PROJECT, 'two.jsonl'), lines);
    const store = new Store(dir);
    await store.refresh(true);
    expect(store.dataStatus().warnings.some((w) => w.includes('more than one transcript'))).toBe(true);
  });
});
