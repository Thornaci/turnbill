import { Bot, Brain, ChevronDown, ChevronRight, CornerDownRight, Scissors } from 'lucide-react';
import { memo, useState } from 'react';
import { modelLabel } from '../../shared/pricing';
import type { CompactionEvent, Prompt, Step, SubagentRun } from '../../shared/types';
import { CATEGORIES, modelColor } from '../lib/colors';
import { clock, count, dateTime, duration, homeRelative, minutes, pct, tokens, usd } from '../lib/format';
import { Badge, cx } from './ui';

const KIND_LABEL: Record<Prompt['kind'], string | null> = {
  prompt: null,
  command: 'Command',
  'compact-summary': 'After compaction',
  continuation: 'Continued',
  system: 'Background',
};

function MiniBar({ prompt }: { prompt: Prompt }) {
  const total = prompt.cost.total || 1;
  return (
    <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
      {CATEGORIES.map((c) => {
        const v = prompt.cost[c.key];
        return v > 0 ? <div key={c.key} style={{ width: `${(v / total) * 100}%`, background: c.color, minWidth: 2 }} /> : null;
      })}
    </div>
  );
}

function topTools(counts: Record<string, number>, n = 4) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export const PromptRow = memo(function PromptRow({
  prompt,
  sessionTotal,
  allModels,
  open,
  onToggle,
  compactionBefore,
}: {
  prompt: Prompt;
  sessionTotal: number;
  allModels: string[];
  open: boolean;
  onToggle: (index: number) => void;
  compactionBefore?: CompactionEvent;
}) {
  const calls = prompt.steps.length + prompt.subagents.reduce((a, r) => a + r.steps.length, 0);
  const kind = KIND_LABEL[prompt.kind];
  const rebuilds = prompt.steps.filter((s) => s.cacheRebuild && s.rebuildReason !== 'first').length;
  return (
    <li id={`prompt-${prompt.index}`} className="scroll-mt-20">
      {compactionBefore && (
        <div className="flex items-center gap-2 bg-surface-2/60 px-5 py-1.5 text-[11.5px] text-fg-3">
          <Scissors size={12} /> Context compacted ({compactionBefore.trigger}) at {tokens(compactionBefore.preTokens)} tokens · {dateTime(compactionBefore.ts)}
        </div>
      )}
      <button onClick={() => onToggle(prompt.index)} aria-expanded={open} className={cx('group flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-surface-2/70', open && 'bg-surface-2/60')}>
        <span className="mt-0.5 text-fg-3">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
        <span className="num mt-px w-9 shrink-0 text-[12px] text-fg-3">#{prompt.index}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            {kind && <Badge>{kind}</Badge>}
            {prompt.interrupted && <Badge tone="warning">Interrupted</Badge>}
            {rebuilds > 0 && (
              <Badge tone="serious" title="The prompt cache had to be rebuilt during this prompt">
                Cache rebuilt
              </Badge>
            )}
            <span className="num text-[11.5px] text-fg-3">{dateTime(prompt.ts)}</span>
          </span>
          <span className={cx('wrap-any mt-1 block text-[13px] leading-snug text-fg', !open && 'clamp-2', open && 'whitespace-pre-wrap')}>
            {open ? prompt.text.slice(0, 4000) + (prompt.text.length > 4000 ? ' …' : '') : prompt.text}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
            <span className="num">{calls} calls</span>
            {prompt.subagents.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Bot size={12} /> {prompt.subagents.length} subagent{prompt.subagents.length > 1 ? 's' : ''}
              </span>
            )}
            <span className="num">{duration(prompt.durationMs)}</span>
            <span className="num">peak {tokens(prompt.peakContext)} ctx</span>
            {topTools(prompt.toolCounts).map(([t, n]) => (
              <span key={t} className="font-mono">
                {t}×{n}
              </span>
            ))}
          </span>
        </span>
        <span className="w-28 shrink-0 pt-0.5 text-right">
          <span className="num block text-[14px] font-medium text-fg">{usd(prompt.cost.total)}</span>
          <span className="num block text-[11.5px] text-fg-3">{pct(prompt.cost.total / (sessionTotal || 1), 1)}</span>
          <span className="mt-1.5 block">
            <MiniBar prompt={prompt} />
          </span>
        </span>
      </button>
      {open && <PromptDetail prompt={prompt} allModels={allModels} />}
    </li>
  );
});

function PromptDetail({ prompt, allModels }: { prompt: Prompt; allModels: string[] }) {
  return (
    <div className="border-t border-line bg-bg/40 pb-3">
      <div className="flex flex-wrap gap-x-5 gap-y-1 px-5 pt-3 pb-2 text-[12px] text-fg-2">
        {CATEGORIES.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1.5" title={c.hint}>
            <span className="h-2 w-2 rounded-[2px]" style={{ background: c.color }} />
            {c.label} <span className="num text-fg">{usd(prompt.cost[c.key])}</span>
          </span>
        ))}
        {prompt.subagents.length > 0 && (
          <span>
            Main thread <span className="num text-fg">{usd(prompt.ownCost)}</span> · subagents <span className="num text-fg">{usd(prompt.cost.total - prompt.ownCost)}</span>
          </span>
        )}
      </div>
      <StepsTable steps={prompt.steps} allModels={allModels} subagents={prompt.subagents} />
    </div>
  );
}

function rebuildText(s: Step) {
  const reason =
    s.rebuildReason === 'idle'
      ? `after ${minutes(s.gapMinutes)} idle`
      : s.rebuildReason === 'model-switch'
        ? 'model switched'
        : s.rebuildReason === 'compaction'
          ? 'after compaction'
          : 'cause unclear';
  return `Cache rebuilt · ${reason}`;
}

export function StepsTable({ steps, allModels, subagents = [], nested }: { steps: Step[]; allModels: string[]; subagents?: SubagentRun[]; nested?: boolean }) {
  // Subagent runs are interleaved by start time with the main-thread calls.
  type Row = { kind: 'step'; step: Step; n: number } | { kind: 'agent'; run: SubagentRun };
  const rows: Row[] = steps.map((step, i) => ({ kind: 'step', step, n: i + 1 }));
  for (const run of subagents) {
    const at = rows.findIndex((r) => r.kind === 'step' && r.step.ts > run.start);
    rows.splice(at < 0 ? rows.length : at, 0, { kind: 'agent', run });
  }
  return (
    <div className="scroll-x">
      <table className={cx('w-full min-w-[980px] text-[12px]', nested && 'bg-surface-2/40')}>
        <thead>
          <tr className="border-b border-line text-fg-3">
            <th className="eyebrow py-1.5 pr-2 pl-5 text-left font-normal">Call</th>
            <th className="eyebrow px-2 py-1.5 text-left font-normal">Time</th>
            <th className="eyebrow px-2 py-1.5 text-left font-normal">Model</th>
            <th className="eyebrow px-2 py-1.5 text-left font-normal">Tools & output</th>
            <th className="eyebrow px-2 py-1.5 text-right font-normal" title="Context size of the request">Context</th>
            {CATEGORIES.map((c) => (
              <th key={c.key} className="eyebrow px-2 py-1.5 text-right font-normal" title={c.hint}>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-[2px]" style={{ background: c.color }} />
                  {c.label.replace('Cache ', '')}
                </span>
              </th>
            ))}
            <th className="eyebrow py-1.5 pr-5 pl-2 text-right font-normal">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.kind === 'step' ? <StepRow key={r.step.id} step={r.step} n={r.n} allModels={allModels} /> : <AgentRow key={r.run.agentId} run={r.run} allModels={allModels} />,
          )}
        </tbody>
      </table>
    </div>
  );
}

function StepRow({ step: s, n, allModels }: { step: Step; n: number; allModels: string[] }) {
  const written = s.usage.cacheWrite1h + s.usage.cacheWrite5m;
  return (
    <tr className={cx('border-b border-line/70 align-top last:border-b-0', s.cacheRebuild && s.rebuildReason !== 'first' && 'bg-[color-mix(in_oklab,var(--status-serious)_7%,transparent)]')}>
      <td className="num py-2 pr-2 pl-5 text-fg-3">{n}</td>
      <td className="num px-2 py-2 whitespace-nowrap text-fg-2">
        {clock(s.ts)}
        {s.gapMinutes != null && s.gapMinutes >= 5 && <div className="text-[11px] text-fg-3">+{minutes(s.gapMinutes)} gap</div>}
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5 text-fg-2">
          <span className="h-2 w-2 rounded-full" style={{ background: modelColor(s.model, allModels) }} />
          {modelLabel(s.model)}
          {s.speed === 'fast' && <Badge>fast</Badge>}
          {s.hasThinking && <Brain size={12} className="text-fg-3" aria-label="Used thinking" />}
        </span>
      </td>
      <td className="max-w-[420px] px-2 py-2">
        {s.cacheRebuild && s.rebuildReason !== 'first' && (
          <div className="mb-1 text-[11.5px] font-medium" style={{ color: 'var(--status-serious)' }}>
            {rebuildText(s)} — {tokens(written)} tokens re-written
          </div>
        )}
        {s.tools.length > 0 ? (
          <ul className="space-y-0.5">
            {s.tools.map((t) => (
              <li key={t.id} className="flex min-w-0 items-baseline gap-1.5" title={t.summary}>
                <span className={cx('shrink-0 font-mono text-[11.5px]', t.isError ? 'text-[var(--status-critical)]' : 'text-fg')}>{t.name}</span>
                <span className="truncate font-mono text-[11.5px] text-fg-3">{homeRelative(t.summary)}</span>
                {t.resultChars > 8000 && (
                  <span className="num shrink-0 text-[11px] text-fg-2" title={`Returned ~${tokens(t.resultChars / 3.5)} tokens; ~${usd(t.carryCost)} to keep in context`}>
                    →{tokens(t.resultChars / 3.5)}
                  </span>
                )}
                {t.isError && <span className="shrink-0 text-[11px] text-[var(--status-critical)]">error</span>}
              </li>
            ))}
          </ul>
        ) : (
          <span className="clamp-2 text-fg-2">{s.textPreview || <span className="text-fg-3">—</span>}</span>
        )}
      </td>
      <td className="num px-2 py-2 text-right text-fg-2">{tokens(s.contextTokens)}</td>
      <td className="num px-2 py-2 text-right" title={`${count(s.usage.cacheRead)} tokens`}>
        {usd(s.cost.cacheRead)}
      </td>
      <td className="num px-2 py-2 text-right" title={`${count(written)} tokens${s.usage.cacheWrite1h ? ' (1h TTL)' : ''}`}>
        {usd(s.cost.cacheWrite)}
      </td>
      <td className="num px-2 py-2 text-right" title={`${count(s.usage.output)} tokens`}>
        {usd(s.cost.output)}
      </td>
      <td className="num px-2 py-2 text-right" title={`${count(s.usage.input)} tokens`}>
        {usd(s.cost.input + s.cost.webSearch)}
      </td>
      <td className="num py-2 pr-5 pl-2 text-right font-medium">{usd(s.cost.total)}</td>
    </tr>
  );
}

function AgentRow({ run, allModels }: { run: SubagentRun; allModels: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-b border-line/70 bg-surface-2/60">
        <td colSpan={9} className="py-2 pr-2 pl-5">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <CornerDownRight size={13} className="text-fg-3" />
            <Bot size={13} className="text-fg-2" />
            <span className="font-medium text-fg">Subagent · {run.agentType}</span>
            {run.description && <span className="truncate text-fg-2">{run.description}</span>}
            <span className="num ml-2 shrink-0 text-fg-3">
              {run.steps.length} calls · {run.models.map(modelLabel).join(', ')} · {Object.entries(run.toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t}×${n}`).join(' ')}
            </span>
          </button>
        </td>
        <td className="num py-2 pr-5 pl-2 text-right font-medium">{usd(run.cost.total)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} className="p-0">
            <StepsTable steps={run.steps} allModels={allModels} nested />
          </td>
        </tr>
      )}
    </>
  );
}
