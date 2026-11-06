import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Overview as OverviewData, ProjectSummary } from '../../shared/types';
import { CompositionBar, DailyChart, Heatmap } from '../components/charts';
import { InsightList, ModelMix, ToolTable } from '../components/panels';
import { Card, CardHeader, cx, Empty, ErrorBox, Kpi, KpiRow, LiveDot, ModelChip, PageSkeleton, ShareBar, SortHeader, Button } from '../components/ui';
import { useApi } from '../lib/api';
import { count, dayLabel, homeRelative, pct, relative, shortDate, tokens, usd } from '../lib/format';
import { download, toCsv } from '../lib/export';
import { useRange, withRange } from '../lib/range';
import { useSettings } from '../lib/settings';

export default function Overview() {
  const range = useRange();
  const { data, error, loading, reload } = useApi<OverviewData>(`/api/overview?${range.query}`, { poll: 20_000 });
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const allModels = data.dataStatus.models;

  if (data.totals.steps === 0) {
    return (
      <Card>
        <Empty title={data.dataStatus.files ? `No Claude Code activity in ${range.label.toLowerCase()}` : 'No Claude Code transcripts found'}>
          {data.dataStatus.files ? 'Pick a longer time range above.' : `Turnbill reads ${data.dataStatus.root}. Run Claude Code in any project and come back.`}
        </Empty>
      </Card>
    );
  }

  return (
    <div className={cx('space-y-4 transition-opacity', loading && 'opacity-[.92]')}>
      <div className="rise flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Overview</h1>
          <p className="text-[13px] text-fg-3">
            {range.label} · {count(data.totals.sessions)} sessions across {count(data.totals.projects)} projects
          </p>
        </div>
        {data.live.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {data.live.slice(0, 3).map((s) => (
              <Link key={s.id} to={withRange(`/sessions/${s.id}`, range.key)} className="card inline-flex max-w-[320px] items-center gap-2.5 px-3 py-1.5 text-[12.5px] hover:bg-surface-2">
                <span className="live-dot shrink-0" />
                <span className="truncate text-fg-2">{s.title}</span>
                <span className="num shrink-0 text-fg">{usd(s.cost.total)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Hero data={data} />

      <KpiRow i={2}>
        <Kpi label="Prompts" value={count(data.totals.prompts)} sub={`${usd(data.totals.cost.total / Math.max(1, data.totals.prompts))} per prompt`} />
        <Kpi label="API calls" value={count(data.totals.steps)} sub={`${(data.totals.steps / Math.max(1, data.totals.prompts)).toFixed(1)} per prompt`} />
        <Kpi label="Tokens processed" value={tokens(data.totals.usage.input + data.totals.usage.cacheRead + data.totals.usage.cacheWrite1h + data.totals.usage.cacheWrite5m + data.totals.usage.output)} sub={`${tokens(data.totals.usage.output)} generated`} />
        <Kpi
          label="Cache hit rate"
          value={pct(data.totals.usage.cacheRead / Math.max(1, data.totals.usage.input + data.totals.usage.cacheRead + data.totals.usage.cacheWrite1h + data.totals.usage.cacheWrite5m), 1)}
          sub="of prompt tokens read from cache"
          title="Share of prompt tokens served from the prompt cache"
        />
        <Kpi label="Subagents" value={usd(data.totals.subagentCost)} sub={`${pct(data.totals.subagentCost / Math.max(1e-9, data.totals.cost.total))} of spend`} />
        <Kpi label="Cache rebuilds" value={usd(data.totals.cacheRebuildCost)} sub="paid above cache-read price" title="Extra paid when a request had to re-write the whole context to the cache" />
      </KpiRow>

      <Card i={3}>
        <ProjectsTable projects={data.projects} allModels={allModels} total={data.totals.cost.total} />
      </Card>

      <Card i={4}>
        <CardHeader title="Daily spend" subtitle="API-equivalent cost per day, by model" />
        <DailyChart data={data.daily} allModels={allModels} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7" i={5}>
          <CardHeader title="Insights" subtitle="Patterns that cost money, with what to do about them" />
          <InsightList insights={data.insights} rangeKey={range.key} />
        </Card>
        <Card className="lg:col-span-5" i={6}>
          <CardHeader title="Models" subtitle="Spend by model, and the same tokens on others" />
          <ModelMix costByModel={data.costByModel} whatIf={data.whatIf} allModels={allModels} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card i={7}>
          <CardHeader title="Most expensive sessions" />
          <ul className="divide-y divide-line">
            {data.topSessions.map((s) => (
              <li key={s.id}>
                <Link to={withRange(`/sessions/${s.id}`, range.key)} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-fg">{s.title}</div>
                    <div className="truncate text-[12px] text-fg-3">
                      {homeRelative(s.cwd).split('/').pop()} · {shortDate(s.start)} · {s.promptCount} prompts · {count(s.stepCount)} calls
                    </div>
                  </div>
                  {s.isLive && <LiveDot />}
                  <div className="num text-[13px]">{usd(s.cost.total)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card i={8}>
          <CardHeader title="Most expensive prompts" subtitle="Including the subagents they started" />
          <ul className="divide-y divide-line">
            {data.topPrompts.map((p) => (
              <li key={`${p.sessionId}-${p.index}`}>
                <Link to={withRange(`/sessions/${p.sessionId}`, range.key) + `#prompt-${p.index}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="clamp-1 text-[13px] text-fg">{p.text || '(no text)'}</div>
                    <div className="truncate text-[12px] text-fg-3">
                      #{p.index} in {p.sessionTitle} · {p.steps} calls · {shortDate(p.ts)}
                    </div>
                  </div>
                  <div className="num text-[13px]">{usd(p.cost)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7" i={9}>
          <CardHeader title="When you spend" subtitle="Day of week × hour, local time" />
          <Heatmap grid={data.heatmap} />
        </Card>
        <Card className="lg:col-span-5" i={10}>
          <CardHeader title="Tools" subtitle="Ranked by the estimated cost of keeping their output in context" />
          <ToolTable tools={data.toolStats} limit={10} />
        </Card>
      </div>
    </div>
  );
}

function Hero({ data }: { data: OverviewData }) {
  const range = useRange();
  const settings = useSettings();
  const t = data.totals;
  const saved = Math.max(0, t.uncachedCost - t.cost.total);
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = data.monthly.find((m) => m.month === monthKey)?.total ?? 0;
  const months = data.monthly.slice(-6);
  const activeDays = data.daily.filter((d) => d.total > 0);
  const busiest = activeDays.reduce<(typeof activeDays)[number] | null>((m, d) => (!m || d.total > m.total ? d : m), null);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projection = (thisMonth / Math.max(1, now.getDate())) * daysInMonth;
  return (
    <Card i={1} className="grid overflow-hidden lg:grid-cols-12">
      <div className="flex flex-col p-5 lg:col-span-7 lg:border-r lg:border-line">
        <div className="eyebrow">API-equivalent spend · {range.label}</div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
          <span className="text-[44px] leading-none font-medium tracking-[-0.02em]">{usd(t.cost.total)}</span>
          <span className="text-[13px] text-fg-3">estimated at API list prices</span>
        </div>
        <div className="mt-5">
          <CompositionBar cost={t.cost} />
        </div>
        <div className="mt-6 grid grid-cols-3 gap-4 border-t border-line pt-4 lg:mt-auto">
          <div>
            <div className="eyebrow">Per active day</div>
            <div className="num mt-1 text-[15px]">{usd(t.cost.total / Math.max(1, activeDays.length))}</div>
            <div className="text-[11.5px] text-fg-3">{activeDays.length} days with activity</div>
          </div>
          <div>
            <div className="eyebrow">Busiest day</div>
            <div className="num mt-1 text-[15px]">{busiest ? usd(busiest.total) : '—'}</div>
            <div className="text-[11.5px] text-fg-3">{busiest ? dayLabel(busiest.date) : ''}</div>
          </div>
          <div title="This month so far, extended at the same daily pace">
            <div className="eyebrow">Month projection</div>
            <div className="num mt-1 text-[15px]">{usd(projection)}</div>
            <div className="text-[11.5px] text-fg-3">at this month’s pace</div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-px bg-[var(--border)] sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
        <div className="bg-surface p-5">
          <div className="eyebrow">Prompt caching saved</div>
          <div className="mt-1.5 text-[22px] font-medium tracking-tight">{usd(saved)}</div>
          <div className="mt-1 text-[12px] text-fg-3">Without caching these requests would cost {usd(t.uncachedCost)} ({(t.uncachedCost / Math.max(1e-9, t.cost.total)).toFixed(1)}×).</div>
        </div>
        <div className="bg-surface p-5">
          {settings.planMonthly ? (
            <>
              <div className="eyebrow">This month vs your {settings.planLabel} plan</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-[22px] font-medium tracking-tight">{(thisMonth / settings.planMonthly).toFixed(1)}×</span>
                <span className="text-[12px] text-fg-3">
                  {usd(thisMonth)} of usage for ${settings.planMonthly}
                </span>
              </div>
              <MonthBars months={months} plan={settings.planMonthly} />
            </>
          ) : (
            <>
              <div className="eyebrow">This month so far</div>
              <div className="mt-1.5 text-[22px] font-medium tracking-tight">{usd(thisMonth)}</div>
              <MonthBars months={months} plan={null} />
              <div className="mt-1 text-[12px] text-fg-3">On a Pro or Max plan? Set it in settings (⚙) to compare usage with what you pay.</div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function MonthBars({ months, plan }: { months: { month: string; total: number }[]; plan: number | null }) {
  const max = Math.max(plan ?? 0, ...months.map((m) => m.total));
  if (months.length < 2) return null;
  return (
    <div className="mt-3">
      <div className="relative flex h-12 items-end gap-1.5">
        {plan != null && max > 0 && (
          <div className="absolute inset-x-0 border-t border-line-strong" style={{ bottom: `${(plan / max) * 100}%` }} title={`Plan price $${plan}`}>
            <span className="absolute -top-2 left-0 -translate-y-1/2 bg-surface pr-1 font-mono text-[10px] text-fg-3">plan ${plan}</span>
          </div>
        )}
        {months.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center justify-end" title={`${m.month}: ${usd(m.total)}`}>
            <div className="w-full rounded-t-[3px]" style={{ height: `${Math.max(2, (m.total / (max || 1)) * 48)}px`, background: 'var(--c1)' }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {months.map((m) => (
          <div key={m.month} className="num flex-1 text-center text-[10px] text-fg-3">
            {new Date(m.month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short' })}
          </div>
        ))}
      </div>
    </div>
  );
}

type ProjectSort = 'name' | 'sessionCount' | 'promptCount' | 'stepCount' | 'lastActive' | 'cost';

function ProjectsTable({ projects, allModels, total }: { projects: ProjectSummary[]; allModels: string[]; total: number }) {
  const navigate = useNavigate();
  const range = useRange();
  const [sort, setSort] = useState<{ key: ProjectSort; dir: 'asc' | 'desc' }>({ key: 'cost', dir: 'desc' });
  const onSort = (key: ProjectSort) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const rows = useMemo(() => {
    const val = (p: ProjectSummary): string | number => (sort.key === 'cost' ? p.cost.total : sort.key === 'name' ? p.name.toLowerCase() : (p[sort.key] as string | number));
    return [...projects].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === 'asc' ? c : -c;
    });
  }, [projects, sort]);
  const max = Math.max(0, ...projects.map((p) => p.cost.total));

  return (
    <>
      <CardHeader
        title="Projects"
        subtitle="Directories where you started Claude Code. Open one to see its sessions."
        right={
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              download(
                'turnbill-projects.csv',
                toCsv(projects.map((p) => ({ project: p.path, sessions: p.sessionCount, prompts: p.promptCount, api_calls: p.stepCount, last_active: p.lastActive, cost_usd: p.cost.total.toFixed(4) }))),
              )
            }
          >
            Export CSV
          </Button>
        }
      />
      <div className="scroll-x">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="border-y border-line bg-surface-2/50">
              <SortHeader k="name" sort={sort} onSort={onSort}>
                <span className="pl-2">Project</span>
              </SortHeader>
              <SortHeader k="sessionCount" sort={sort} onSort={onSort} align="right">
                Sessions
              </SortHeader>
              <SortHeader k="promptCount" sort={sort} onSort={onSort} align="right">
                Prompts
              </SortHeader>
              <SortHeader k="stepCount" sort={sort} onSort={onSort} align="right">
                API calls
              </SortHeader>
              <SortHeader k="lastActive" sort={sort} onSort={onSort}>
                Last active
              </SortHeader>
              <th className="eyebrow px-3 py-2 text-left font-normal">Main model</th>
              <SortHeader k="cost" sort={sort} onSort={onSort} align="right">
                <span className="pr-2">Spend</span>
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const to = withRange(`/projects/${encodeURIComponent(p.id)}`, range.key);
              return (
                <tr key={p.id} onClick={() => navigate(to)} className="cursor-pointer border-b border-line last:border-b-0 hover:bg-surface-2">
                  <td className="max-w-[380px] px-5 py-2.5">
                    <Link to={to} className="block min-w-0" onClick={(e) => e.stopPropagation()}>
                      <div className="truncate font-medium text-fg">{p.name}</div>
                      <div className="truncate font-mono text-[11.5px] text-fg-3">{homeRelative(p.path)}</div>
                    </Link>
                  </td>
                  <td className="num px-3 py-2.5 text-right">{count(p.sessionCount)}</td>
                  <td className="num px-3 py-2.5 text-right">{count(p.promptCount)}</td>
                  <td className="num px-3 py-2.5 text-right text-fg-2">{count(p.stepCount)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-fg-2">
                    <span className="inline-flex items-center gap-2">
                      {relative(p.lastActive)}
                      {p.isLive && <LiveDot />}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{p.topModel ? <ModelChip model={p.topModel} allModels={allModels} /> : '—'}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center justify-end gap-3">
                      <div className="hidden w-28 md:block">
                        <ShareBar value={p.cost.total} max={max} />
                      </div>
                      <span className="num w-[76px] text-right font-medium">{usd(p.cost.total)}</span>
                      <span className="num w-10 text-right text-[11.5px] text-fg-3">{pct(p.cost.total / (total || 1))}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {projects.length === 0 && <Empty title="No projects in this range" />}
    </>
  );
}
