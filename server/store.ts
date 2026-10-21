import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addCost, addUsage, costOf, MODEL_PRICES, normalizeModelId, priceUncached, ratesFor, whatIfModels, zeroCost, zeroUsage } from '../shared/pricing';
import type {
  DailyPoint,
  DataStatus,
  Overview,
  ProjectSummary,
  SearchHit,
  SessionDetail,
  SessionSummary,
  Step,
  ToolStat,
  Usage,
} from '../shared/types';
import { globalInsights, sessionInsights } from './insights';
import { parseSession, rebuildPremium, type SessionFiles } from './parser';

export interface Range {
  from: number | null;
  to: number | null;
}

interface Entry {
  signature: string;
  detail: SessionDetail;
  /** Every billable request in the session, main thread and subagents, for range filtering. */
  flat: { ts: number; step: Step; subagent: boolean; promptIndex: number }[];
}

const RESCAN_INTERVAL_MS = 3000;
export const BIG_CONTEXT_TOKENS = 200_000;

export function defaultRoot(): string {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

export class Store {
  private entries = new Map<string, Entry>();
  private projectPaths = new Map<string, string>();
  private lastScan = 0;
  private scanning: Promise<void> | null = null;
  private status: DataStatus;

  constructor(readonly root: string = defaultRoot()) {
    this.status = { root, files: 0, bytes: 0, parsedAt: '', parseMs: 0, warnings: [], calibration: { sessions: 0, reportedUSD: 0, estimatedUSD: 0 }, models: [] };
  }

  /** Rescans the projects directory if the last scan is older than a few seconds. */
  async refresh(force = false): Promise<void> {
    if (this.scanning) return this.scanning;
    if (!force && Date.now() - this.lastScan < RESCAN_INTERVAL_MS) return;
    this.scanning = this.scan().finally(() => {
      this.scanning = null;
      this.lastScan = Date.now();
    });
    return this.scanning;
  }

  private async scan() {
    const started = Date.now();
    const warnings: string[] = [];
    let projectDirs: string[] = [];
    try {
      projectDirs = (await readdir(this.root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      warnings.push(`Could not read ${this.root}. Is Claude Code installed, or is CLAUDE_CONFIG_DIR set?`);
    }

    const seen = new Set<string>();
    let files = 0;
    let bytes = 0;
    const jobs: (() => Promise<void>)[] = [];

    for (const projectId of projectDirs) {
      const dir = path.join(this.root, projectId);
      let names: string[] = [];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        const id = name.slice(0, -'.jsonl'.length);
        const mainFile = path.join(dir, name);
        const key = `${projectId}/${id}`;
        seen.add(key);
        const subDir = path.join(dir, id, 'subagents');
        const subagentFiles: SessionFiles['subagentFiles'] = [];
        let signature = '';
        let mtimeMs = 0;
        let size = 0;
        try {
          const s = await stat(mainFile);
          mtimeMs = s.mtimeMs;
          size = s.size;
          signature = `${s.mtimeMs}:${s.size}`;
        } catch {
          continue;
        }
        try {
          const subs = await readdir(subDir);
          for (const sub of subs.sort()) {
            if (!sub.endsWith('.jsonl')) continue;
            const file = path.join(subDir, sub);
            const s = await stat(file);
            mtimeMs = Math.max(mtimeMs, s.mtimeMs);
            size += s.size;
            signature += `|${sub}:${s.mtimeMs}:${s.size}`;
            const meta = sub.replace(/\.jsonl$/, '.meta.json');
            subagentFiles.push({ file, metaFile: subs.includes(meta) ? path.join(subDir, meta) : null });
          }
        } catch {
          // No subagents for this session.
        }
        files += 1 + subagentFiles.length;
        bytes += size;
        const existing = this.entries.get(key);
        // Liveness depends on the clock, so recompute it even when the files are unchanged.
        if (existing && existing.signature === signature) {
          existing.detail.isLive = Date.now() - mtimeMs < 3 * 60_000;
          continue;
        }
        jobs.push(async () => {
          try {
            const detail = await parseSession({ id, projectId, mainFile, subagentFiles }, { mtimeMs, fileBytes: size });
            detail.insights = sessionInsights(detail);
            this.entries.set(key, { signature, detail, flat: flatten(detail) });
          } catch (err) {
            warnings.push(`Failed to parse ${mainFile}: ${(err as Error).message}`);
          }
        });
      }
    }

    await runLimited(jobs, 8);
    for (const key of [...this.entries.keys()]) if (!seen.has(key)) this.entries.delete(key);

    this.projectPaths.clear();
    const cwdVotes = new Map<string, Map<string, number>>();
    for (const e of this.entries.values()) {
      const d = e.detail;
      if (!d.cwd) continue;
      const votes = cwdVotes.get(d.projectId) ?? new Map<string, number>();
      votes.set(d.cwd, (votes.get(d.cwd) ?? 0) + 1);
      cwdVotes.set(d.projectId, votes);
    }
    for (const [projectId, votes] of cwdVotes) {
      this.projectPaths.set(projectId, [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    }

    const calibration = { sessions: 0, reportedUSD: 0, estimatedUSD: 0 };
    for (const e of this.entries.values()) {
      const r = e.detail.reported;
      if (!r || r.windowEstimate <= 0 || r.totalUSD <= 0) continue;
      calibration.sessions++;
      calibration.reportedUSD += r.totalUSD;
      calibration.estimatedUSD += r.windowEstimate;
    }

    const owners = new Map<string, string>();
    let shared = 0;
    for (const [key, e] of this.entries) {
      for (const f of e.flat) {
        const owner = owners.get(f.step.id);
        if (owner === undefined) owners.set(f.step.id, key);
        else if (owner !== key) shared++;
      }
    }
    if (shared) {
      warnings.push(`${shared} API calls appear in more than one transcript (usually a resumed session that copied its history); they are counted in each, so totals may be overstated.`);
    }

    const empty = [...this.entries.values()].filter((e) => e.detail.stepCount === 0).length;
    if (empty) warnings.push(`${empty} session file${empty === 1 ? '' : 's'} with no billable API calls are hidden.`);
    this.status = {
      root: this.root,
      files,
      bytes,
      parsedAt: new Date().toISOString(),
      parseMs: Date.now() - started,
      warnings,
      calibration,
      models: orderModels(new Set([...this.entries.values()].flatMap((e) => Object.keys(e.detail.costByModel)))),
    };
  }

  private valid(): Entry[] {
    return [...this.entries.values()].filter((e) => e.detail.stepCount > 0);
  }

  projectPath(projectId: string): string {
    return this.projectPaths.get(projectId) ?? decodeProjectId(projectId);
  }

  getSession(id: string): SessionDetail | null {
    for (const e of this.entries.values()) if (e.detail.id === id) return e.detail;
    return null;
  }

  dataStatus(): DataStatus {
    return this.status;
  }

  /** Session summaries with cost restricted to requests inside the range. */
  sessions(range: Range, projectId?: string): SessionSummary[] {
    const out: SessionSummary[] = [];
    for (const e of this.valid()) {
      if (projectId && e.detail.projectId !== projectId) continue;
      const s = rangedSummary(e, range);
      if (s) out.push(s);
    }
    return out.sort((a, b) => (a.end < b.end ? 1 : -1));
  }

  projects(range: Range): ProjectSummary[] {
    const map = new Map<string, ProjectSummary>();
    const modelCost = new Map<string, Record<string, number>>();
    for (const s of this.sessions(range)) {
      let p = map.get(s.projectId);
      if (!p) {
        const projectPath = this.projectPath(s.projectId);
        p = {
          id: s.projectId,
          path: projectPath,
          name: path.basename(projectPath) || projectPath,
          sessionCount: 0,
          promptCount: 0,
          stepCount: 0,
          usage: zeroUsage(),
          cost: zeroCost(),
          firstActive: s.start,
          lastActive: s.end,
          topModel: null,
          isLive: false,
        };
        map.set(s.projectId, p);
      }
      p.sessionCount++;
      p.promptCount += s.promptCount;
      p.stepCount += s.stepCount;
      addUsage(p.usage, s.usage);
      addCost(p.cost, s.cost);
      if (s.start < p.firstActive) p.firstActive = s.start;
      if (s.end > p.lastActive) p.lastActive = s.end;
      p.isLive ||= s.isLive;
      const mc = modelCost.get(s.projectId) ?? {};
      for (const [m, c] of Object.entries(s.costByModel)) mc[m] = (mc[m] ?? 0) + c;
      modelCost.set(s.projectId, mc);
    }
    for (const p of map.values()) {
      const mc = modelCost.get(p.id) ?? {};
      p.topModel = Object.entries(mc).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    return [...map.values()].sort((a, b) => b.cost.total - a.cost.total);
  }

  overview(range: Range): Overview {
    const sessions = this.sessions(range);
    const projects = this.projects(range);
    const totals = {
      cost: zeroCost(),
      usage: zeroUsage(),
      sessions: sessions.length,
      projects: projects.length,
      prompts: 0,
      steps: 0,
      uncachedCost: 0,
      subagentCost: 0,
      cacheRebuildCost: 0,
    };
    const daily = new Map<string, DailyPoint>();
    const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const costByModel: Record<string, number> = {};
    const usageByModel: Record<string, Usage> = {};
    const tools = new Map<string, ToolStat>();
    const promptCosts: Overview['topPrompts'] = [];
    const rebuildBySession = new Map<string, number>();
    const whatIfTargets = whatIfModels();
    const whatIf = new Map<string, number>();
    let bigContextCost = 0;

    for (const e of this.valid()) {
      const promptCost = new Map<number, number>();
      const promptSteps = new Map<number, number>();
      for (const f of e.flat) {
        if (!inRange(f.ts, range)) continue;
        const s = f.step;
        addCost(totals.cost, s.cost);
        addUsage(totals.usage, s.usage);
        totals.steps++;
        const unbilled = s.refusal != null && !s.refusal.billed;
        if (!unbilled) {
          totals.uncachedCost += priceUncached(s.model, s.usage, { speed: s.speed, geo: s.geo });
          for (const m of whatIfTargets) whatIf.set(m.id, (whatIf.get(m.id) ?? 0) + costOf(s.usage, ratesFor(m, s.usage)).total);
        }
        const premium = rebuildPremium(s);
        if (premium > 0) {
          totals.cacheRebuildCost += premium;
          rebuildBySession.set(e.detail.id, (rebuildBySession.get(e.detail.id) ?? 0) + premium);
        }
        if (f.subagent) totals.subagentCost += s.cost.total;
        if (s.contextTokens > BIG_CONTEXT_TOKENS) bigContextCost += s.cost.total;
        costByModel[s.model] = (costByModel[s.model] ?? 0) + s.cost.total;
        addUsage((usageByModel[s.model] ??= zeroUsage()), s.usage);
        const d = new Date(f.ts);
        const day = localDate(d);
        const point = daily.get(day) ?? { date: day, total: 0, byModel: {}, steps: 0 };
        point.total += s.cost.total;
        point.byModel[s.model] = (point.byModel[s.model] ?? 0) + s.cost.total;
        point.steps++;
        daily.set(day, point);
        heatmap[(d.getDay() + 6) % 7][d.getHours()] += s.cost.total;
        for (const t of s.tools) {
          const ts = tools.get(t.name) ?? { name: t.name, calls: 0, errors: 0, resultChars: 0, carryCost: 0 };
          ts.calls++;
          if (t.isError) ts.errors++;
          ts.resultChars += t.resultChars;
          ts.carryCost += t.carryCost;
          tools.set(t.name, ts);
        }
        promptCost.set(f.promptIndex, (promptCost.get(f.promptIndex) ?? 0) + s.cost.total);
        promptSteps.set(f.promptIndex, (promptSteps.get(f.promptIndex) ?? 0) + 1);
      }
      for (const p of e.detail.prompts) {
        if (!promptCost.has(p.index)) continue;
        if (p.kind === 'prompt' || p.kind === 'command') totals.prompts++;
        promptCosts.push({
          sessionId: e.detail.id,
          projectId: e.detail.projectId,
          sessionTitle: e.detail.title,
          index: p.index,
          text: p.text.slice(0, 240),
          cost: promptCost.get(p.index)!,
          steps: promptSteps.get(p.index) ?? 0,
          ts: p.ts,
        });
      }
    }

    const monthly = new Map<string, number>();
    for (const e of this.valid()) {
      for (const f of e.flat) {
        const m = localDate(new Date(f.ts)).slice(0, 7);
        monthly.set(m, (monthly.get(m) ?? 0) + f.step.cost.total);
      }
    }

    const topPrompts = promptCosts.sort((a, b) => b.cost - a.cost).slice(0, 10);
    const overview: Overview = {
      range: { from: range.from ? new Date(range.from).toISOString() : null, to: range.to ? new Date(range.to).toISOString() : null },
      totals,
      monthly: [...monthly.entries()].sort().map(([month, total]) => ({ month, total })),
      daily: fillDays([...daily.values()].sort((a, b) => (a.date < b.date ? -1 : 1))),
      heatmap,
      costByModel,
      usageByModel,
      topSessions: [...sessions].sort((a, b) => b.cost.total - a.cost.total).slice(0, 8),
      live: this.sessions({ from: null, to: null }).filter((s) => s.isLive),
      topPrompts,
      whatIf: whatIfTargets.map((m) => ({ id: m.id, label: m.label, cost: whatIf.get(m.id) ?? 0 })),
      toolStats: [...tools.values()].sort((a, b) => b.carryCost - a.carryCost),
      projects,
      insights: [],
      dataStatus: this.status,
    };
    overview.insights = globalInsights(overview, { bigContextCost, rebuildBySession, sessions });
    return overview;
  }

  project(projectId: string, range: Range): { project: ProjectSummary; sessions: SessionSummary[]; daily: DailyPoint[] } | null {
    let project = this.projects(range).find((p) => p.id === projectId);
    if (!project) {
      const known = this.projects({ from: null, to: null }).find((p) => p.id === projectId);
      if (!known) return null;
      project = { ...known, sessionCount: 0, promptCount: 0, stepCount: 0, usage: zeroUsage(), cost: zeroCost(), isLive: false };
    }
    const daily = new Map<string, DailyPoint>();
    for (const e of this.valid()) {
      if (e.detail.projectId !== projectId) continue;
      for (const f of e.flat) {
        if (!inRange(f.ts, range)) continue;
        const day = localDate(new Date(f.ts));
        const point = daily.get(day) ?? { date: day, total: 0, byModel: {}, steps: 0 };
        point.total += f.step.cost.total;
        point.byModel[f.step.model] = (point.byModel[f.step.model] ?? 0) + f.step.cost.total;
        point.steps++;
        daily.set(day, point);
      }
    }
    return {
      project,
      sessions: this.sessions(range, projectId),
      daily: fillDays([...daily.values()].sort((a, b) => (a.date < b.date ? -1 : 1))),
    };
  }

  search(query: string, limit = 80): SearchHit[] {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits: SearchHit[] = [];
    for (const e of this.valid()) {
      const d = e.detail;
      const base = { sessionId: d.id, projectId: d.projectId, sessionTitle: d.title, projectPath: this.projectPath(d.projectId) };
      if (d.title.toLowerCase().includes(q)) {
        hits.push({ ...base, promptIndex: 0, kind: 'title', snippet: d.title, ts: d.start, cost: d.cost.total });
      }
      for (const p of d.prompts) {
        const lower = p.text.toLowerCase();
        const at = lower.indexOf(q);
        if (at >= 0) hits.push({ ...base, promptIndex: p.index, kind: 'prompt', snippet: snippet(p.text, at, q.length), ts: p.ts, cost: p.cost.total });
        const steps = [...p.steps, ...p.subagents.flatMap((r) => r.steps)];
        let toolHits = 0;
        for (const s of steps) {
          for (const t of s.tools) {
            if (toolHits >= 3) break;
            const hay = `${t.name} ${t.summary}`;
            const i = hay.toLowerCase().indexOf(q);
            if (i >= 0) {
              toolHits++;
              hits.push({ ...base, promptIndex: p.index, kind: 'tool', snippet: snippet(hay, i, q.length), ts: s.ts, cost: s.cost.total });
            }
          }
        }
      }
    }
    return hits.sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, limit);
  }
}

function snippet(text: string, at: number, len: number): string {
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + len + 100);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
}

function flatten(d: SessionDetail): Entry['flat'] {
  const flat: Entry['flat'] = [];
  for (const p of d.prompts) {
    for (const step of p.steps) flat.push({ ts: Date.parse(step.ts), step, subagent: false, promptIndex: p.index });
    for (const r of p.subagents) for (const step of r.steps) flat.push({ ts: Date.parse(step.ts), step, subagent: true, promptIndex: p.index });
  }
  return flat;
}

function inRange(ts: number, range: Range): boolean {
  if (!Number.isFinite(ts)) return range.from == null && range.to == null;
  if (range.from != null && ts < range.from) return false;
  if (range.to != null && ts > range.to) return false;
  return true;
}

function rangedSummary(e: Entry, range: Range): SessionSummary | null {
  const { prompts, compactionEvents, insights, toolStats, ...summary } = e.detail;
  if (range.from == null && range.to == null) return summary;
  const steps = e.flat.filter((f) => inRange(f.ts, range));
  if (steps.length === 0) return null;
  const usage = zeroUsage();
  const cost = zeroCost();
  const costByModel: Record<string, number> = {};
  let subagentCost = 0;
  const promptIdx = new Set<number>();
  for (const f of steps) {
    addUsage(usage, f.step.usage);
    addCost(cost, f.step.cost);
    costByModel[f.step.model] = (costByModel[f.step.model] ?? 0) + f.step.cost.total;
    if (f.subagent) subagentCost += f.step.cost.total;
    promptIdx.add(f.promptIndex);
  }
  const promptCount = prompts.filter((p) => promptIdx.has(p.index) && (p.kind === 'prompt' || p.kind === 'command')).length;
  let start = '';
  let end = '';
  for (const f of steps) {
    if (!start || f.step.ts < start) start = f.step.ts;
    if (f.step.ts > end) end = f.step.ts;
  }
  return { ...summary, start: start || summary.start, end: end || summary.end, usage, cost, costByModel, subagentCost, stepCount: steps.length, promptCount };
}

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Inserts zero days so charts show gaps honestly. */
function fillDays(points: DailyPoint[]): DailyPoint[] {
  if (points.length < 2) return points;
  const out: DailyPoint[] = [];
  const byDate = new Map(points.map((p) => [p.date, p]));
  const [y, m, d] = points[0].date.split('-').map(Number);
  const cursor = new Date(y, m - 1, d);
  const last = points[points.length - 1].date;
  while (localDate(cursor) <= last) {
    const key = localDate(cursor);
    out.push(byDate.get(key) ?? { date: key, total: 0, byModel: {}, steps: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function orderModels(models: Set<string>): string[] {
  const rank = (m: string) => {
    const i = MODEL_PRICES.findIndex((p) => p.id === normalizeModelId(m));
    return i < 0 ? MODEL_PRICES.length : i;
  };
  return [...models].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Best-effort decode of a project directory name when no transcript recorded a cwd. */
function decodeProjectId(id: string): string {
  return id.replace(/-/g, '/');
}

async function runLimited(jobs: (() => Promise<void>)[], limit: number) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await job();
    }
  });
  await Promise.all(workers);
}
