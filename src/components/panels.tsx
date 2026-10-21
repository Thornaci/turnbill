import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { costOf, modelLabel, whatIfModels } from '../../shared/pricing';
import type { Insight, Step, ToolStat, Usage } from '../../shared/types';
import { modelColor } from '../lib/colors';
import { count, pct, tokens, usd } from '../lib/format';
import { withRange, type RangeKey } from '../lib/range';
import { cx, Empty, SeverityMark, ShareBar } from './ui';

export function InsightList({ insights, rangeKey, onPrompt, compact }: { insights: Insight[]; rangeKey?: RangeKey; onPrompt?: (i: number) => void; compact?: boolean }) {
  if (!insights.length) {
    return <Empty title="Nothing stands out">No waste patterns crossed the thresholds for this selection.</Empty>;
  }
  return (
    <ul className="divide-y divide-line">
      {insights.map((it) => {
        const link =
          it.sessionId && !onPrompt
            ? withRange(`/sessions/${it.sessionId}`, rangeKey ?? 'all') + (it.promptIndex ? `#prompt-${it.promptIndex}` : '')
            : it.projectId && !it.sessionId
              ? withRange(`/projects/${encodeURIComponent(it.projectId)}`, rangeKey ?? 'all')
              : null;
        return (
          <li key={it.id + (it.sessionId ?? '')} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SeverityMark severity={it.severity} />
                <div className="wrap-any mt-1 text-[13.5px] font-medium leading-snug text-fg">{it.title}</div>
                <p className={cx('wrap-any mt-1 text-[12.5px] leading-relaxed text-fg-2', compact && 'clamp-2')}>{it.detail}</p>
                <div className="mt-1.5 flex flex-wrap gap-3 text-[12px]">
                  {link && (
                    <Link to={link} className="inline-flex items-center gap-1 text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg">
                      Open {it.sessionId ? 'session' : 'project'} <ArrowRight size={12} />
                    </Link>
                  )}
                  {onPrompt && it.promptIndex && (
                    <button onClick={() => onPrompt(it.promptIndex!)} className="inline-flex items-center gap-1 text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg">
                      Jump to prompt #{it.promptIndex} <ArrowRight size={12} />
                    </button>
                  )}
                </div>
              </div>
              {it.impactUSD != null && it.impactUSD > 0 && <div className="num shrink-0 text-[13px] text-fg">{usd(it.impactUSD)}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Spend by model plus a what-if: the same token counts priced on another model. */
export function ModelMix({ costByModel, usageByModel, steps, allModels }: { costByModel: Record<string, number>; usageByModel?: Record<string, Usage>; steps?: Step[]; allModels: string[] }) {
  const total = Object.values(costByModel).reduce((a, b) => a + b, 0);
  const rows = Object.entries(costByModel).sort((a, b) => b[1] - a[1]);
  const targets = whatIfModels().map((m) => {
    let cost = 0;
    if (steps) {
      for (const s of steps) {
        const rates = m.longContext && s.contextTokens > m.longContext.threshold ? m.longContext.rates : m.rates;
        cost += costOf(s.usage, rates).total;
      }
    } else if (usageByModel) {
      for (const u of Object.values(usageByModel)) cost += costOf(u, m.rates).total;
    }
    return { id: m.id, label: m.label, cost };
  });
  if (!rows.length) return <Empty title="No usage" />;
  return (
    <div className="px-5 pb-5">
      <table className="w-full text-[12.5px]">
        <tbody>
          {rows.map(([m, c]) => (
            <tr key={m}>
              <td className="py-1.5 pr-3">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: modelColor(m, allModels) }} />
                  {modelLabel(m)}
                </span>
              </td>
              <td className="w-[40%] py-1.5 pr-3">
                <ShareBar value={c} max={rows[0][1]} color={modelColor(m, allModels)} />
              </td>
              <td className="num py-1.5 pr-3 text-right text-fg-3">{pct(c / (total || 1))}</td>
              <td className="num py-1.5 text-right">{usd(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="eyebrow mt-5 mb-1.5">What if every call used…</div>
      <table className="w-full text-[12.5px]">
        <tbody>
          {targets.map((t) => {
            const delta = t.cost - total;
            return (
              <tr key={t.id} className="border-t border-line first:border-t-0">
                <td className="py-1.5 pr-3 text-fg-2">{t.label}</td>
                <td className="num py-1.5 pr-3 text-right">{usd(t.cost)}</td>
                <td className={cx('num w-24 py-1.5 text-right', delta < 0 ? 'text-fg' : 'text-fg-3')}>
                  {Math.abs(delta) < 0.005 ? '—' : `${delta < 0 ? '−' : '+'}${usd(Math.abs(delta))}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] leading-snug text-fg-3">
        Same token counts at list prices. A different model would take a different number of turns and tokens, so read this as a price comparison, not a forecast.
      </p>
    </div>
  );
}

export function ToolTable({ tools, limit = 12 }: { tools: ToolStat[]; limit?: number }) {
  const rows = tools.slice(0, limit);
  const max = Math.max(0, ...rows.map((t) => t.carryCost));
  if (!rows.length) return <Empty title="No tool calls" />;
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[420px] text-[12.5px]">
        <thead>
          <tr className="border-b border-line">
            <th className="eyebrow px-5 py-2 text-left font-normal">Tool</th>
            <th className="eyebrow px-3 py-2 text-right font-normal">Calls</th>
            <th className="eyebrow px-3 py-2 text-right font-normal">Errors</th>
            <th className="eyebrow px-3 py-2 text-right font-normal" title="Approximate tokens returned by the tool">Returned</th>
            <th className="eyebrow px-5 py-2 text-right font-normal" title="Estimated cost of keeping these results in context for the rest of the session">Carry cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.name} className="border-b border-line last:border-b-0">
              <td className="max-w-[220px] truncate px-5 py-2 font-mono text-[12px]" title={t.name}>
                {t.name}
              </td>
              <td className="num px-3 py-2 text-right">{count(t.calls)}</td>
              <td className={cx('num px-3 py-2 text-right', t.errors ? 'text-fg' : 'text-fg-3')}>{t.errors ? count(t.errors) : '—'}</td>
              <td className="num px-3 py-2 text-right text-fg-2">~{tokens(t.resultChars / 3.5)}</td>
              <td className="px-5 py-2">
                <div className="flex items-center justify-end gap-3">
                  <div className="hidden w-20 2xl:block">
                    <ShareBar value={t.carryCost} max={max} color="var(--c1)" />
                  </div>
                  <span className="num w-16 text-right">{usd(t.carryCost)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
