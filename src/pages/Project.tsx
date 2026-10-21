import { Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DailyPoint, DataStatus, ProjectSummary, SessionSummary } from '../../shared/types';
import { CompositionBar, DailyChart } from '../components/charts';
import { Crumbs } from '../components/Layout';
import { Button, Card, CardHeader, cx, Empty, ErrorBox, Kpi, KpiRow, LiveDot, ModelChip, PageSkeleton, ShareBar, SortHeader } from '../components/ui';
import { copyText } from '../lib/analyze';
import { useApi } from '../lib/api';
import { count, dateTime, duration, homeRelative, pct, relative, tokens, usd } from '../lib/format';
import { download, slug, toCsv } from '../lib/export';
import { useRange, withRange } from '../lib/range';

interface ProjectData {
  project: ProjectSummary;
  sessions: SessionSummary[];
  daily: DailyPoint[];
}

type SessionSort = 'end' | 'cost' | 'stepCount' | 'promptCount' | 'activeMs';

export default function Project() {
  const { projectId = '' } = useParams();
  const range = useRange();
  const navigate = useNavigate();
  const { data, error, reload, loading } = useApi<ProjectData>(`/api/projects/${encodeURIComponent(projectId)}?${range.query}`, { poll: 15_000 });
  const status = useApi<DataStatus>('/api/status');
  const [sort, setSort] = useState<{ key: SessionSort; dir: 'asc' | 'desc' }>({ key: 'end', dir: 'desc' });
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);

  const sessions = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    const list = q ? data.sessions.filter((s) => `${s.title} ${s.firstPrompt} ${s.gitBranch ?? ''}`.toLowerCase().includes(q)) : data.sessions;
    const val = (s: SessionSummary) => (sort.key === 'cost' ? s.cost.total : s[sort.key]);
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === 'asc' ? c : -c;
    });
  }, [data, filter, sort]);

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const { project } = data;
  const allModels = status.data?.models ?? [];
  const onSort = (key: SessionSort) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const max = Math.max(0, ...data.sessions.map((s) => s.cost.total));
  const avg = project.cost.total / Math.max(1, project.sessionCount);

  return (
    <div className={cx('space-y-4 transition-opacity', loading && 'opacity-[.92]')}>
      <div className="rise">
        <Crumbs items={[{ label: 'Overview', to: withRange('/', range.key) }, { label: project.name }]} />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-3 text-[22px] font-semibold tracking-tight">
              {project.name}
              {project.isLive && <LiveDot />}
            </h1>
            <button
              className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[12px] text-fg-3 hover:text-fg"
              title="Copy path"
              onClick={async () => {
                if (await copyText(project.path)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                }
              }}
            >
              {homeRelative(project.path)} <Copy size={11} /> {copied && <span className="font-sans">copied</span>}
            </button>
          </div>
          <Button
            size="sm"
            onClick={() =>
              download(
                `tokenscope-${slug(project.name)}-sessions.csv`,
                toCsv(
                  data.sessions.map((s) => ({
                    session_id: s.id,
                    title: s.title,
                    start: s.start,
                    end: s.end,
                    active_minutes: Math.round(s.activeMs / 60000),
                    prompts: s.promptCount,
                    api_calls: s.stepCount,
                    models: s.models.join(' '),
                    cache_read_usd: s.cost.cacheRead.toFixed(4),
                    cache_write_usd: s.cost.cacheWrite.toFixed(4),
                    output_usd: s.cost.output.toFixed(4),
                    input_usd: s.cost.input.toFixed(4),
                    total_usd: s.cost.total.toFixed(4),
                  })),
                ),
              )
            }
          >
            Export sessions CSV
          </Button>
        </div>
      </div>

      <KpiRow i={1}>
        <Kpi label="Spend" value={usd(project.cost.total)} sub={range.label} />
        <Kpi label="Sessions" value={count(project.sessionCount)} sub={`${usd(avg)} on average`} />
        <Kpi label="Prompts" value={count(project.promptCount)} sub={`${usd(project.cost.total / Math.max(1, project.promptCount))} per prompt`} />
        <Kpi label="API calls" value={count(project.stepCount)} sub={`${(project.stepCount / Math.max(1, project.promptCount)).toFixed(1)} per prompt`} />
        <Kpi label="Cache hit rate" value={pct(project.usage.cacheRead / Math.max(1, project.usage.input + project.usage.cacheRead + project.usage.cacheWrite1h + project.usage.cacheWrite5m), 1)} sub={`${tokens(project.usage.cacheRead)} tokens from cache`} />
        <Kpi label="Last active" value={relative(project.lastActive)} sub={`since ${dateTime(project.firstActive)}`} />
      </KpiRow>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8" i={2}>
          <CardHeader title="Daily spend" subtitle="This project only" />
          <DailyChart data={data.daily} allModels={allModels} height={190} />
        </Card>
        <Card className="lg:col-span-4" i={3}>
          <CardHeader title="Where the money went" />
          <div className="px-5 pb-5">
            <CompositionBar cost={project.cost} />
          </div>
        </Card>
      </div>

      <Card i={4}>
        <CardHeader
          title="Sessions"
          subtitle="Each Claude Code session; /clear starts a new one."
          right={
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter sessions"
              aria-label="Filter sessions"
              className="h-8 w-56 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] placeholder:text-fg-3 focus:border-[var(--focus)] focus:outline-none"
            />
          }
        />
        <div className="scroll-x">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="border-y border-line bg-surface-2/50">
                <th className="eyebrow px-5 py-2 text-left font-normal">Session</th>
                <SortHeader k="end" sort={sort} onSort={onSort}>
                  When
                </SortHeader>
                <SortHeader k="activeMs" sort={sort} onSort={onSort} align="right">
                  Active
                </SortHeader>
                <SortHeader k="promptCount" sort={sort} onSort={onSort} align="right">
                  Prompts
                </SortHeader>
                <SortHeader k="stepCount" sort={sort} onSort={onSort} align="right">
                  Calls
                </SortHeader>
                <th className="eyebrow px-3 py-2 text-left font-normal">Models</th>
                <SortHeader k="cost" sort={sort} onSort={onSort} align="right">
                  <span className="pr-2">Cost</span>
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const to = withRange(`/sessions/${s.id}`, range.key);
                return (
                  <tr key={s.id} onClick={() => navigate(to)} className="cursor-pointer border-b border-line last:border-b-0 hover:bg-surface-2">
                    <td className="max-w-[420px] px-5 py-2.5">
                      <Link to={to} onClick={(e) => e.stopPropagation()} className="block min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-fg">{s.title}</span>
                          {s.isLive && <LiveDot />}
                        </div>
                        {s.firstPrompt && s.firstPrompt !== s.title && <div className="truncate text-[12px] text-fg-3">{s.firstPrompt}</div>}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-fg-2">
                      <div>{relative(s.end)}</div>
                      <div className="text-[11.5px] text-fg-3">{dateTime(s.start)}</div>
                    </td>
                    <td className="num px-3 py-2.5 text-right text-fg-2">{duration(s.activeMs)}</td>
                    <td className="num px-3 py-2.5 text-right">{s.promptCount}</td>
                    <td className="num px-3 py-2.5 text-right text-fg-2">{count(s.stepCount)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(s.costByModel)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 2)
                          .map(([m]) => (
                            <ModelChip key={m} model={m} allModels={allModels} />
                          ))}
                        {Object.keys(s.costByModel).length > 2 && <span className="text-[11.5px] text-fg-3">+{Object.keys(s.costByModel).length - 2}</span>}
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-end gap-3">
                        <div className="hidden w-24 md:block">
                          <ShareBar value={s.cost.total} max={max} />
                        </div>
                        <span className="num w-[72px] text-right font-medium">{usd(s.cost.total)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sessions.length === 0 && <Empty title={filter ? 'No sessions match' : 'No sessions in this range'} />}
      </Card>
    </div>
  );
}
