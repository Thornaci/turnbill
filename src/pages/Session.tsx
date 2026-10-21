import { ChevronsDownUp, ChevronsUpDown, ExternalLink, GitBranch, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { isAvoidableRebuild } from '../../shared/steps';
import type { DataStatus, SessionDetail } from '../../shared/types';
import { AnalyzeModal } from '../components/AnalyzeModal';
import { buildCallPoints, CompositionBar, PromptCostChart, SessionCallsChart } from '../components/charts';
import { Crumbs } from '../components/Layout';
import { InsightList, ModelMix, ToolTable } from '../components/panels';
import { PromptRow } from '../components/PromptList';
import { Button, Card, CardHeader, cx, ErrorBox, Kpi, KpiRow, LiveDot, ModelChip, PageSkeleton, Segmented, Stat } from '../components/ui';
import { useApi } from '../lib/api';
import { count, dateTime, duration, homeRelative, pct, tokens, usd } from '../lib/format';
import { download, slug, toCsv } from '../lib/export';
import { useRange, withRange } from '../lib/range';

type Session = SessionDetail & { projectPath?: string };
type View = 'all' | 'prompts' | 'expensive';
type Order = 'time' | 'cost';

export default function SessionPage() {
  const { sessionId = '' } = useParams();
  const location = useLocation();
  const range = useRange();
  const [poll, setPoll] = useState<number | undefined>(undefined);
  const { data, error, reload } = useApi<Session>(`/api/sessions/${sessionId}`, { poll });
  const status = useApi<DataStatus>('/api/status');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [view, setView] = useState<View>('all');
  const [order, setOrder] = useState<Order>('time');
  const [analyze, setAnalyze] = useState(false);
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => setPoll(data?.isLive ? 5000 : undefined), [data?.isLive]);

  const jump = useCallback((index: number, smooth = true) => {
    setOpen((s) => new Set(s).add(index));
    setView('all');
    setTimeout(() => document.getElementById(`prompt-${index}`)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }), 60);
  }, []);

  useEffect(() => {
    const m = /^#prompt-(\d+)$/.exec(location.hash);
    if (data && m && scrolledFor.current !== location.hash) {
      scrolledFor.current = location.hash;
      jump(Number(m[1]), false);
    }
  }, [data, location.hash, jump]);

  const toggle = useCallback((index: number) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(index)) n.delete(index);
      else n.add(index);
      return n;
    });
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const allSteps = data.prompts.flatMap((p) => [...p.steps, ...p.subagents.flatMap((r) => r.steps)]);
    const mainSteps = data.prompts.flatMap((p) => p.steps);
    const points = buildCallPoints(data.prompts);
    const compactAt: number[] = [];
    let n = 0;
    for (const p of data.prompts) {
      if (data.compactionEvents.some((c) => c.afterPromptIndex === p.index) && n > 0) compactAt.push(n + 1);
      n += p.steps.length;
    }
    const promptTokens = data.usage.input + data.usage.cacheRead + data.usage.cacheWrite1h + data.usage.cacheWrite5m;
    const avgCtx = mainSteps.length ? mainSteps.reduce((a, s) => a + s.contextTokens, 0) / mainSteps.length : 0;
    const sorted = [...data.prompts].map((p) => p.cost.total).sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)] ?? 0;
    return { allSteps, points, compactAt, promptTokens, avgCtx, p80 };
  }, [data]);

  const visible = useMemo(() => {
    if (!data || !derived) return [];
    let list = data.prompts;
    if (view === 'prompts') list = list.filter((p) => p.kind === 'prompt' || p.kind === 'command');
    if (view === 'expensive') list = list.filter((p) => p.cost.total >= derived.p80 && p.cost.total > 0);
    if (order === 'cost') list = [...list].sort((a, b) => b.cost.total - a.cost.total);
    return list;
  }, [data, derived, view, order]);

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || !derived) return <PageSkeleton />;
  const allModels = status.data?.models ?? Object.keys(data.costByModel);
  const projectName = (data.projectPath || data.cwd).split('/').filter(Boolean).pop() ?? data.projectId;
  const reported = data.reported && data.reported.windowEstimate > 0 ? data.reported : null;

  const exportPrompts = () =>
    download(
      `tokenscope-${slug(data.title)}-prompts.csv`,
      toCsv(
        data.prompts.map((p) => ({
          prompt: p.index,
          kind: p.kind,
          time: p.ts,
          text: p.text.slice(0, 500),
          api_calls: p.steps.length + p.subagents.reduce((a, r) => a + r.steps.length, 0),
          subagents: p.subagents.length,
          duration_s: p.durationMs != null ? Math.round(p.durationMs / 1000) : '',
          peak_context: p.peakContext,
          cache_read_usd: p.cost.cacheRead.toFixed(4),
          cache_write_usd: p.cost.cacheWrite.toFixed(4),
          output_usd: p.cost.output.toFixed(4),
          input_usd: p.cost.input.toFixed(4),
          total_usd: p.cost.total.toFixed(4),
        })),
      ),
    );
  const exportCalls = () =>
    download(
      `tokenscope-${slug(data.title)}-api-calls.csv`,
      toCsv(
        data.prompts.flatMap((p) =>
          [...p.steps.map((s) => ({ s, agent: '' })), ...p.subagents.flatMap((r) => r.steps.map((s) => ({ s, agent: r.agentType })))].map(({ s, agent }) => ({
            prompt: p.index,
            subagent: agent,
            time: s.ts,
            model: s.model,
            tools: s.tools.map((t) => `${t.name}${t.summary ? `(${t.summary})` : ''}`).join('; '),
            input_tokens: s.usage.input,
            cache_read_tokens: s.usage.cacheRead,
            cache_write_5m_tokens: s.usage.cacheWrite5m,
            cache_write_1h_tokens: s.usage.cacheWrite1h,
            output_tokens: s.usage.output,
            context_tokens: s.contextTokens,
            cache_rebuild: isAvoidableRebuild(s) ? s.rebuildReason : '',
            refusal: s.refusal ? `${s.refusal.category ?? 'unknown'} (${s.refusal.billed ? 'billed' : 'not billed'})` : '',
            cost_usd: s.cost.total.toFixed(5),
          })),
        ),
      ),
    );

  return (
    <div className="space-y-4">
      <div className="rise">
        <Crumbs
          items={[
            { label: 'Overview', to: withRange('/', range.key) },
            { label: projectName, to: withRange(`/projects/${encodeURIComponent(data.projectId)}`, range.key) },
            { label: 'Session' },
          ]}
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <h1 className="flex flex-wrap items-center gap-3 text-[22px] leading-tight font-semibold tracking-tight">
              <span className="wrap-any min-w-0">{data.title}</span>
              {data.isLive && <LiveDot label="Live · refreshing" />}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
              <span className="wrap-any font-mono">{homeRelative(data.cwd)}</span>
              {data.gitBranch && (
                <span className="inline-flex items-center gap-1">
                  <GitBranch size={12} /> {data.gitBranch}
                </span>
              )}
              <span>
                {dateTime(data.start)} → {dateTime(data.end)}
              </span>
              <span>active {duration(data.activeMs)}</span>
              {data.version && <span>Claude Code {data.version}</span>}
              {data.prLinks.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-line-strong underline-offset-2 hover:text-fg">
                  {u.replace(/^https:\/\/github\.com\//, '').replace('/pull/', '#')} <ExternalLink size={11} />
                </a>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(data.costByModel)
                .sort((a, b) => b[1] - a[1])
                .map(([m, c]) => (
                  <ModelChip key={m} model={m} allModels={allModels} cost={usd(c)} />
                ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={exportPrompts}>
              Prompts CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={exportCalls}>
              API calls CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={() => download(`tokenscope-${slug(data.title)}.json`, JSON.stringify(data, null, 2), 'application/json')}>
              JSON
            </Button>
            <Button variant="primary" onClick={() => setAnalyze(true)}>
              <Sparkles size={14} /> Analyze
            </Button>
          </div>
        </div>
      </div>

      <KpiRow i={1}>
        <Kpi label="Estimated cost" value={usd(data.cost.total)} sub={`${usd(data.cost.total / Math.max(1, data.promptCount))} per prompt`} />
        <Kpi label="Prompts" value={count(data.promptCount)} sub={data.prompts.length > data.promptCount ? `+${data.prompts.length - data.promptCount} background / continued` : 'typed or commands'} />
        <Kpi label="API calls" value={count(data.stepCount)} sub={`${(data.stepCount / Math.max(1, data.promptCount)).toFixed(1)} per prompt`} />
        <Kpi label="Cache hit rate" value={pct(data.usage.cacheRead / Math.max(1, derived.promptTokens), 1)} sub={`${tokens(derived.promptTokens)} prompt tokens`} />
        <Kpi label="Context" value={`${tokens(derived.avgCtx)} avg`} sub={`peak ${tokens(data.peakContext)} · ${data.compactions} compaction${data.compactions === 1 ? '' : 's'}`} />
        <Kpi label="Subagents" value={usd(data.subagentCost)} sub={`${data.subagentCount} run${data.subagentCount === 1 ? '' : 's'} · ${pct(data.subagentCost / Math.max(1e-9, data.cost.total))}`} />
      </KpiRow>

      {reported && (
        <div className="rise flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border border-dashed border-line-strong px-5 py-3 text-[12.5px] text-fg-2" style={{ ['--i' as string]: 2 }}>
          <span className="eyebrow">Cross-check</span>
          <span>
            Claude Code’s own counter for its last run{reported.startTime ? ` (since ${dateTime(reported.startTime)})` : ''}: <span className="num text-fg">{usd(reported.totalUSD)}</span>
          </span>
          <span>
            Tokenscope for the same window: <span className="num text-fg">{usd(reported.windowEstimate)}</span> ({pct(reported.windowEstimate / reported.totalUSD)})
          </span>
          <span className="text-fg-3">The gap is background requests (titles, summaries, compaction) that are not written to the transcript.</span>
          {(reported.linesAdded > 0 || reported.linesRemoved > 0) && (
            <span className="num ml-auto text-fg-3">
              +{count(reported.linesAdded)} / −{count(reported.linesRemoved)} lines
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8" i={3}>
          <CardHeader title="Cost per prompt" subtitle="Each bar is one prompt and everything it triggered. Click a bar to open it." />
          <PromptCostChart prompts={data.prompts} onPick={jump} />
        </Card>
        <Card className="lg:col-span-4" i={4}>
          <CardHeader title="Where the money went" />
          <div className="px-5 pb-5">
            <CompositionBar cost={data.cost} />
            <div className="mt-4 border-t border-line pt-3">
              <Stat label="Cache rebuilds" value={`${data.cacheRebuilds} · ${usd(data.cacheRebuildCost)} extra`} />
              <Stat label="Output tokens" value={tokens(data.usage.output)} />
              <Stat label="Cache writes (1h / 5m)" value={`${tokens(data.usage.cacheWrite1h)} / ${tokens(data.usage.cacheWrite5m)}`} />
              <Stat label="Cache reads" value={tokens(data.usage.cacheRead)} />
              <Stat label="Uncached input" value={tokens(data.usage.input)} />
              {data.usage.webSearches > 0 && <Stat label="Web searches" value={count(data.usage.webSearches)} />}
            </div>
          </div>
        </Card>
      </div>

      <Card i={5}>
        <CardHeader title="API calls over the session" subtitle="Main thread only. Context grows until it is compacted or the cache expires; every call re-reads it." />
        <SessionCallsChart points={derived.points} compactAt={derived.compactAt} onPick={jump} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7" i={6}>
          <CardHeader
            title="Insights"
            subtitle="Heuristics — use Analyze for a deeper review"
            right={
              <Button size="sm" onClick={() => setAnalyze(true)}>
                <Sparkles size={13} /> Analyze
              </Button>
            }
          />
          <InsightList insights={data.insights} onPrompt={jump} />
        </Card>
        <Card className="lg:col-span-5" i={7}>
          <CardHeader title="Models" subtitle="Spend by model and a price what-if" />
          <ModelMix costByModel={data.costByModel} steps={derived.allSteps} allModels={allModels} />
        </Card>
      </div>

      <Card i={8}>
        <CardHeader
          title="Prompts"
          subtitle="Every message you sent and the API calls it caused, with the token mix and cost of each call."
          right={
            <>
              <Segmented<View>
                label="Filter prompts"
                value={view}
                onChange={setView}
                options={[
                  { key: 'all', label: 'All' },
                  { key: 'prompts', label: 'Typed', title: 'Hide background notifications and continuations' },
                  { key: 'expensive', label: 'Top 20%', title: 'Most expensive fifth of prompts' },
                ]}
              />
              <Segmented<Order> label="Order" value={order} onChange={setOrder} options={[{ key: 'time', label: 'Time' }, { key: 'cost', label: 'Cost' }]} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpen((s) => (s.size ? new Set() : new Set(visible.map((p) => p.index))))}
                title={open.size ? 'Collapse all' : 'Expand all'}
              >
                {open.size ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
              </Button>
            </>
          }
        />
        <ul className={cx('divide-y divide-line border-t border-line')}>
          {visible.map((p) => (
            <PromptRow
              key={p.index}
              prompt={p}
              sessionTotal={data.cost.total}
              allModels={allModels}
              open={open.has(p.index)}
              onToggle={toggle}
              compactionBefore={order === 'time' ? data.compactionEvents.find((c) => c.afterPromptIndex === p.index) : undefined}
            />
          ))}
        </ul>
      </Card>

      <Card i={9}>
        <CardHeader title="Tools in this session" subtitle="Carry cost: estimated price of keeping each tool’s output in context until compaction or the end" />
        <ToolTable tools={data.toolStats} limit={20} />
      </Card>

      <AnalyzeModal open={analyze} onClose={() => setAnalyze(false)} session={data} />
    </div>
  );
}
