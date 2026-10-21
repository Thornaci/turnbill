import { useMemo, useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ComposedChart, Tooltip, XAxis, YAxis } from 'recharts';
import { modelLabel } from '../../shared/pricing';
import { isAvoidableRebuild } from '../../shared/steps';
import type { Cost, DailyPoint, Prompt, Step } from '../../shared/types';
import { CATEGORIES, modelColor } from '../lib/colors';
import { dateTime, dayLabel, pct, tokens, usd, usdShort } from '../lib/format';
import { Legend } from './ui';

const AXIS = { axisLine: false, tickLine: false } as const;
const DENSE_CALLS = 400;

export function TooltipCard({ title, rows, footer }: { title: ReactNode; rows: { label: string; value: string; color?: string; strong?: boolean }[]; footer?: ReactNode }) {
  return (
    <div className="card min-w-[190px] px-3 py-2.5 text-[12px] shadow-lg" style={{ boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
      <div className="mb-1.5 font-medium text-fg">{title}</div>
      <div className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-fg-2">
              {r.color && <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: r.color }} />}
              <span className="truncate">{r.label}</span>
            </span>
            <span className={r.strong ? 'num font-semibold text-fg' : 'num text-fg'}>{r.value}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5 text-[11.5px] text-fg-3">{footer}</div>}
    </div>
  );
}

/** Part-to-whole of spend by token category, as one thin stacked bar. */
export function CompositionBar({ cost, height = 10 }: { cost: Cost; height?: number }) {
  const total = cost.total || 1;
  const parts = CATEGORIES.map((c) => ({ ...c, value: cost[c.key] })).filter((p) => p.value > 0);
  return (
    <div>
      <div className="flex w-full gap-[2px] overflow-hidden rounded-[4px]" style={{ height }} role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.value / total)}`).join(', ')}>
        {parts.map((p) => (
          <div key={p.key} title={`${p.label}: ${usd(p.value)} (${pct(p.value / total, 1)})`} style={{ width: `${(p.value / total) * 100}%`, background: p.color, minWidth: 2 }} />
        ))}
      </div>
      <div className="mt-2.5">
        <Legend items={CATEGORIES.map((c) => ({ label: c.label, color: c.color, value: `${usd(cost[c.key])} · ${pct(cost[c.key] / total)}` }))} />
      </div>
    </div>
  );
}

export function DailyChart({ data, allModels, height = 220 }: { data: DailyPoint[]; allModels: string[]; height?: number }) {
  const models = useMemo(() => allModels.filter((m) => data.some((d) => d.byModel[m])), [data, allModels]);
  const rows = useMemo(() => data.map((d) => ({ date: d.date, total: d.total, steps: d.steps, ...d.byModel })), [data]);
  if (!data.length) return <div className="px-5 pb-6 text-[13px] text-fg-3">No activity in this range.</div>;
  return (
    <div>
      <div className="px-5 pb-2">
        <Legend items={models.map((m) => ({ label: modelLabel(m), color: modelColor(m, allModels) }))} />
      </div>
      <div style={{ height }} className="pr-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap={rows.length > 60 ? 1 : '18%'}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="date" {...AXIS} tickFormatter={dayLabel} minTickGap={28} interval="preserveStartEnd" />
            <YAxis {...AXIS} tickFormatter={usdShort} width={52} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                const rows = models
                  .filter((m) => d[m])
                  .sort((a, b) => d[b] - d[a])
                  .map((m) => ({ label: modelLabel(m), value: usd(d[m]), color: modelColor(m, allModels) }));
                return <TooltipCard title={dayLabel(String(label))} rows={[...rows, { label: 'Total', value: usd(d.total), strong: true }]} footer={`${d.steps.toLocaleString()} API calls`} />;
              }}
            />
            {models.map((m) => (
              <Bar key={m} dataKey={m} stackId="a" fill={modelColor(m, allModels)} stroke="var(--surface)" strokeWidth={1} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Heatmap({ grid }: { grid: number[][] }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(0, ...grid.flat());
  const step = (v: number) => (v <= 0 || max <= 0 ? 0 : Math.min(7, 1 + Math.floor(Math.sqrt(v / max) * 6.999)));
  const total = grid.flat().reduce((a, b) => a + b, 0);
  const caption = hover ? `${DAYS[hover.d]} ${String(hover.h).padStart(2, '0')}:00–${String(hover.h + 1).padStart(2, '0')}:00 · ${usd(grid[hover.d][hover.h])} · ${pct(grid[hover.d][hover.h] / (total || 1), 1)} of spend` : 'Hover a cell for details. Darker = more spend (local time).';
  return (
    <div className="px-5 pb-5">
      <div className="scroll-x">
        <div className="grid min-w-[520px] gap-[3px]" style={{ gridTemplateColumns: '34px repeat(24, minmax(0, 1fr))' }} onMouseLeave={() => setHover(null)}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="num text-center text-[10px] text-fg-3">
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </div>
          ))}
          {grid.map((row, d) => (
            <div key={d} className="contents">
              <div className="num pr-1 text-right text-[10.5px] leading-[18px] text-fg-3">{DAYS[d]}</div>
              {row.map((v, h) => (
                <div
                  key={h}
                  onMouseEnter={() => setHover({ d, h })}
                  title={`${DAYS[d]} ${h}:00 — ${usd(v)}`}
                  className="h-[18px] rounded-[3px] transition-[outline] duration-75"
                  style={{ background: `var(--seq-${step(v)})`, outline: hover?.d === d && hover?.h === h ? '2px solid var(--text)' : 'none', outlineOffset: 0 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-fg-3">
        <span className="num">{caption}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="num">$0</span>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((s) => (
            <span key={s} className="h-2.5 w-3.5 rounded-[2px]" style={{ background: `var(--seq-${s})` }} />
          ))}
          <span className="num">{usdShort(max)}</span>
        </span>
      </div>
    </div>
  );
}

export interface CallPoint {
  n: number;
  prompt: number;
  ts: string;
  context: number;
  cost: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  input: number;
  rebuild: number | null;
  tools: string;
  model: string;
}

export function buildCallPoints(prompts: Prompt[]): CallPoint[] {
  const out: CallPoint[] = [];
  for (const p of prompts) {
    for (const s of p.steps) out.push(point(out.length + 1, p.index, s));
  }
  return out;
}

function point(n: number, prompt: number, s: Step): CallPoint {
  return {
    n,
    prompt,
    ts: s.ts,
    context: s.contextTokens,
    cost: s.cost.total,
    cacheRead: s.cost.cacheRead,
    cacheWrite: s.cost.cacheWrite,
    output: s.cost.output,
    input: s.cost.input + s.cost.webSearch,
    rebuild: isAvoidableRebuild(s) ? s.contextTokens : null,
    tools: s.tools.map((t) => t.name).join(', '),
    model: s.model,
  };
}

/**
 * Two aligned small multiples over the main-thread API calls: context size (tokens) and cost
 * per call ($). Separate y-axes on separate plots, never one dual-axis chart.
 */
export function SessionCallsChart({ points, compactAt, onPick }: { points: CallPoint[]; compactAt: number[]; onPick?: (prompt: number) => void }) {
  if (points.length < 2) return <div className="px-5 pb-6 text-[13px] text-fg-3">Not enough API calls to chart.</div>;
  const tip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d: CallPoint = payload[0].payload;
    return (
      <TooltipCard
        title={`Call ${d.n} · prompt #${d.prompt}`}
        rows={[
          { label: 'Context', value: `${tokens(d.context)} tokens` },
          ...CATEGORIES.map((c) => ({ label: c.label, value: usd(d[c.key as 'cacheRead' | 'cacheWrite' | 'output' | 'input']), color: c.color })),
          { label: 'Cost', value: usd(d.cost), strong: true },
        ]}
        footer={
          <>
            {dateTime(d.ts)} · {modelLabel(d.model)}
            {d.tools && <div className="truncate">Tools: {d.tools}</div>}
            {d.rebuild != null && <div style={{ color: 'var(--status-serious)' }}>Cache rebuilt on this call</div>}
          </>
        }
      />
    );
  };
  const click = (e: any) => {
    const idx = e?.activeTooltipIndex ?? e?.activeIndex;
    const p = idx != null ? points[Number(idx)] : undefined;
    if (p && onPick) onPick(p.prompt);
  };
  return (
    <div className="px-2 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-1">
        <span className="eyebrow">Context size per call</span>
        <Legend
          items={[
            { label: 'Context tokens', color: 'var(--c1)' },
            { label: 'Cache rebuild', color: 'var(--status-serious)' },
            ...(compactAt.length ? [{ label: 'Compaction', color: 'var(--text-3)' }] : []),
          ]}
        />
      </div>
      <div style={{ height: 170 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} syncId="calls" margin={{ top: 6, right: 12, bottom: 0, left: 4 }} onClick={click} style={{ cursor: onPick ? 'pointer' : undefined }}>
            <defs>
              <linearGradient id="ctxFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--c1)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--c1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="n" {...AXIS} hide />
            <YAxis {...AXIS} tickFormatter={(v) => tokens(v)} width={52} />
            <Tooltip content={tip} cursor={{ stroke: 'var(--border-strong)' }} />
            {compactAt.map((n) => (
              <ReferenceLine
                key={n}
                x={n}
                stroke="var(--text-3)"
                strokeWidth={1}
                label={compactAt.length <= 4 ? { value: 'compacted', position: 'insideTopLeft', fill: 'var(--text-3)', fontSize: 10 } : undefined}
              />
            ))}
            <Area type="monotone" dataKey="context" stroke="var(--c1)" strokeWidth={2} fill="url(#ctxFill)" isAnimationActive={false} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} />
            <Scatter dataKey="rebuild" fill="var(--status-serious)" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} shape="circle" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2 pb-1">
        <span className="eyebrow">Cost per call</span>
        <Legend items={CATEGORIES.map((c) => ({ label: c.label, color: c.color }))} />
      </div>
      <div style={{ height: 130 }}>
        <ResponsiveContainer width="100%" height="100%">
          {points.length > DENSE_CALLS ? (
            // Thousands of sub-pixel bars are slow to draw; stepped areas show the same thing with four paths.
            <AreaChart data={points} syncId="calls" margin={{ top: 4, right: 12, bottom: 0, left: 4 }} onClick={click} style={{ cursor: onPick ? 'pointer' : undefined }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="n" {...AXIS} minTickGap={30} />
              <YAxis {...AXIS} tickFormatter={usdShort} width={52} />
              <Tooltip content={tip} cursor={{ stroke: 'var(--border-strong)' }} />
              {CATEGORIES.map((c) => (
                <Area key={c.key} type="stepAfter" dataKey={c.key} stackId="c" stroke="none" fill={c.color} fillOpacity={0.9} isAnimationActive={false} activeDot={false} />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={points} syncId="calls" margin={{ top: 4, right: 12, bottom: 0, left: 4 }} barCategoryGap={points.length > 120 ? 0 : '12%'} onClick={click} style={{ cursor: onPick ? 'pointer' : undefined }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="n" {...AXIS} minTickGap={30} />
              <YAxis {...AXIS} tickFormatter={usdShort} width={52} />
              <Tooltip content={tip} cursor={{ fill: 'var(--surface-2)' }} />
              {CATEGORIES.map((c) => (
                <Bar key={c.key} dataKey={c.key} stackId="c" fill={c.color} isAnimationActive={false} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PromptCostChart({ prompts, onPick }: { prompts: Prompt[]; onPick?: (prompt: number) => void }) {
  const rows = prompts.map((p) => ({
    n: p.index,
    text: p.text,
    total: p.cost.total,
    cacheRead: p.cost.cacheRead,
    cacheWrite: p.cost.cacheWrite,
    output: p.cost.output,
    input: p.cost.input + p.cost.webSearch,
    calls: p.steps.length + p.subagents.reduce((a, r) => a + r.steps.length, 0),
  }));
  if (!rows.length) return null;
  return (
    <div className="px-2 pb-3">
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 6, right: 12, bottom: 0, left: 4 }}
            barCategoryGap={rows.length > 80 ? 1 : '16%'}
            onClick={(e: any) => {
              const idx = e?.activeTooltipIndex ?? e?.activeIndex;
              if (idx != null && rows[Number(idx)] && onPick) onPick(rows[Number(idx)].n);
            }}
            style={{ cursor: onPick ? 'pointer' : undefined }}
          >
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="n" {...AXIS} tickFormatter={(v) => `#${v}`} minTickGap={20} />
            <YAxis {...AXIS} tickFormatter={usdShort} width={52} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={({ active, payload }: any) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <TooltipCard
                    title={`Prompt #${d.n}`}
                    rows={[...CATEGORIES.map((c) => ({ label: c.label, value: usd(d[c.key]), color: c.color })), { label: 'Total', value: usd(d.total), strong: true }]}
                    footer={
                      <>
                        <div className="clamp-2 max-w-[260px]">{d.text}</div>
                        <div className="mt-1">{d.calls} API calls · click to open</div>
                      </>
                    }
                  />
                );
              }}
            />
            {CATEGORIES.map((c) => (
              <Bar key={c.key} dataKey={c.key} stackId="p" fill={c.color} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
