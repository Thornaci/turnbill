import { costOf, MODEL_PRICES, resolvePrice } from '../shared/pricing';
import type { Insight, Overview, SessionDetail, SessionSummary, Severity, Step } from '../shared/types';
import { CHARS_PER_TOKEN } from './parser';

const usd = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const ktok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}K`);

function severityByShare(share: number, amount: number): Severity {
  if (share >= 0.25 && amount >= 2) return 'high';
  if (share >= 0.1 && amount >= 0.5) return 'medium';
  return 'low';
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Re-prices every request of a session on `targetModel`, keeping token counts. */
export function repriceSteps(steps: Step[], targetModel: string): number {
  const target = MODEL_PRICES.find((m) => m.id === targetModel);
  if (!target) return 0;
  let total = 0;
  for (const s of steps) {
    let rates = target.rates;
    if (target.longContext && s.contextTokens > target.longContext.threshold) rates = target.longContext.rates;
    total += costOf(s.usage, rates).total;
  }
  return total;
}

export function sessionInsights(d: SessionDetail): Insight[] {
  const out: Insight[] = [];
  const total = d.cost.total;
  if (total <= 0) return out;
  const mainSteps = d.prompts.flatMap((p) => p.steps.map((s) => ({ s, p: p.index })));
  const allSteps = d.prompts.flatMap((p) => [...p.steps, ...p.subagents.flatMap((r) => r.steps)]);

  // 1. Cache rebuilds.
  if (d.cacheRebuildCost >= 0.25) {
    const reasons: Record<string, number> = {};
    for (const { s } of mainSteps) if (s.cacheRebuild && s.rebuildReason !== 'first') reasons[s.rebuildReason ?? 'unknown'] = (reasons[s.rebuildReason ?? 'unknown'] ?? 0) + 1;
    const parts = [
      reasons.idle && `${reasons.idle} after idle gaps longer than the cache lifetime`,
      reasons['model-switch'] && `${reasons['model-switch']} after switching models`,
      reasons.compaction && `${reasons.compaction} after compaction`,
      reasons.unknown && `${reasons.unknown} with no obvious trigger`,
    ].filter(Boolean);
    const share = d.cacheRebuildCost / total;
    out.push({
      id: 'cache-rebuild',
      severity: severityByShare(share, d.cacheRebuildCost),
      title: `Prompt cache was rebuilt ${d.cacheRebuilds}× — ${usd(d.cacheRebuildCost)} extra`,
      detail:
        `Requests that re-write the whole context to cache instead of reading it: ${parts.join(', ')}. ` +
        `Claude Code caches context for 1 hour; coming back after a long break, or changing models with /model, makes the next request pay the write price again. ` +
        `For a new task after a break, /clear (or a fresh session with a short summary) is usually cheaper than resuming a large context.`,
      impactUSD: d.cacheRebuildCost,
      sessionId: d.id,
    });
  }

  // 2. Context size.
  const avgContext = mainSteps.length ? mainSteps.reduce((a, { s }) => a + s.contextTokens, 0) / mainSteps.length : 0;
  if (d.peakContext > 200_000 || avgContext > 120_000) {
    const readCost = d.cost.cacheRead;
    out.push({
      id: 'context-size',
      severity: avgContext > 200_000 ? 'high' : 'medium',
      title: `Large context: ${ktok(avgContext)} tokens per request on average, peak ${ktok(d.peakContext)}`,
      detail:
        `Every request re-reads the whole conversation, so cost per request grows with context. Cache reads alone were ${usd(readCost)} (${pct(readCost / total)} of this session). ` +
        `Splitting unrelated tasks into separate sessions, or using /compact at natural checkpoints, keeps each request smaller.`,
      impactUSD: readCost,
      sessionId: d.id,
    });
  }

  // 3. Heavy tool results that stayed in context.
  const heavy = mainSteps
    .flatMap(({ s, p }) => s.tools.map((t) => ({ t, p })))
    .filter(({ t }) => t.carryCost >= 0.25)
    .sort((a, b) => b.t.carryCost - a.t.carryCost);
  if (heavy.length) {
    const top = heavy.slice(0, 3);
    const sum = heavy.reduce((a, h) => a + h.t.carryCost, 0);
    out.push({
      id: 'heavy-tool-output',
      severity: severityByShare(sum / total, sum),
      title: `${heavy.length} large tool result${heavy.length > 1 ? 's' : ''} kept costing money in context (~${usd(sum)})`,
      detail:
        top.map(({ t, p }) => `${t.name} ${t.summary ? `“${t.summary}” ` : ''}in prompt #${p}: ~${ktok(t.resultChars / CHARS_PER_TOKEN)} tokens, ~${usd(t.carryCost)} to carry`).join('; ') +
        `. Big file reads and command outputs are re-read on every later request. Prefer targeted reads (offset/limit), grep with narrow patterns, and piping long command output through head/tail.`,
      impactUSD: sum,
      sessionId: d.id,
      promptIndex: top[0].p,
    });
  }

  // 4. Repeated reads of the same file.
  const reads = new Map<string, number>();
  for (const { s } of mainSteps) for (const t of s.tools) if (t.name === 'Read' && t.summary) reads.set(t.summary, (reads.get(t.summary) ?? 0) + 1);
  const repeated = [...reads.entries()].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]);
  if (repeated.length) {
    out.push({
      id: 'repeated-reads',
      severity: repeated[0][1] >= 8 ? 'medium' : 'low',
      title: `Same files read repeatedly`,
      detail:
        repeated.slice(0, 4).map(([f, n]) => `${f} ×${n}`).join(', ') +
        `. Re-reading a file appends another full copy to the context. After compaction this can be legitimate; otherwise point Claude at line ranges or describe the change you want.`,
      sessionId: d.id,
    });
  }

  // 5. Expensive prompts.
  const realPrompts = d.prompts.filter((p) => p.kind === 'prompt' || p.kind === 'command');
  const med = median(realPrompts.map((p) => p.cost.total));
  const outliers = realPrompts.filter((p) => p.cost.total >= 1 && med > 0 && p.cost.total >= 5 * med).sort((a, b) => b.cost.total - a.cost.total);
  if (outliers.length) {
    const p = outliers[0];
    const steps = p.steps.length + p.subagents.reduce((a, r) => a + r.steps.length, 0);
    out.push({
      id: 'expensive-prompt',
      severity: p.cost.total / total > 0.3 ? 'high' : 'medium',
      title: `Prompt #${p.index} cost ${usd(p.cost.total)} — ${Math.round(p.cost.total / med)}× the session median`,
      detail:
        `It took ${steps} API calls${p.subagents.length ? ` including ${p.subagents.length} subagent run${p.subagents.length > 1 ? 's' : ''}` : ''}. ` +
        (outliers.length > 1 ? `${outliers.length - 1} more prompt${outliers.length > 2 ? 's were' : ' was'} also 5× above median. ` : '') +
        `Open-ended prompts let the agent explore; stating the files, the acceptance check, and what not to touch usually shortens the loop.`,
      impactUSD: p.cost.total,
      sessionId: d.id,
      promptIndex: p.index,
    });
  }

  // 6. Interrupted work.
  const interrupted = d.prompts.filter((p) => p.interrupted);
  const interruptedCost = interrupted.reduce((a, p) => a + p.cost.total, 0);
  if (interruptedCost >= 0.5) {
    out.push({
      id: 'interrupted',
      severity: interruptedCost / total > 0.15 ? 'medium' : 'low',
      title: `${interrupted.length} interrupted prompt${interrupted.length > 1 ? 's' : ''} — ${usd(interruptedCost)} spent before stopping`,
      detail: `Interrupts often mean the request was ambiguous or the agent headed the wrong way. Plan mode or a one-line constraint up front is cheaper than course-correcting midway.`,
      impactUSD: interruptedCost,
      sessionId: d.id,
      promptIndex: interrupted[0].index,
    });
  }

  // 7. Subagent share.
  if (d.subagentCost / total >= 0.3 && d.subagentCost >= 1) {
    out.push({
      id: 'subagents',
      severity: 'info',
      title: `Subagents accounted for ${pct(d.subagentCost / total)} of spend (${usd(d.subagentCost)})`,
      detail: `${d.subagentCount} subagent run${d.subagentCount > 1 ? 's' : ''}. Each starts with its own context and system prompt; they pay off for broad searches but add up when used for small lookups.`,
      impactUSD: d.subagentCost,
      sessionId: d.id,
    });
  }

  // 8. Tool errors.
  const toolCalls = d.toolStats.reduce((a, t) => a + t.calls, 0);
  const toolErrors = d.toolStats.reduce((a, t) => a + t.errors, 0);
  if (toolErrors >= 8 && toolErrors / Math.max(1, toolCalls) >= 0.1) {
    const worst = [...d.toolStats].sort((a, b) => b.errors - a.errors)[0];
    out.push({
      id: 'tool-errors',
      severity: 'low',
      title: `${toolErrors} tool calls failed (${pct(toolErrors / toolCalls)})`,
      detail: `Most failures: ${worst.name} (${worst.errors}). Each failure is a paid round trip; recurring ones usually point to a missing permission, a wrong path, or a flaky command worth fixing in CLAUDE.md.`,
      sessionId: d.id,
    });
  }

  // 9. Model choice.
  const expensive = Object.entries(d.costByModel).filter(([m]) => resolvePrice(m)?.price.family === 'fable');
  const fableCost = expensive.reduce((a, [, c]) => a + c, 0);
  if (fableCost >= 2 && fableCost / total >= 0.4) {
    const fableSteps = allSteps.filter((s) => resolvePrice(s.model)?.price.family === 'fable');
    const onOpus = repriceSteps(fableSteps, 'claude-opus-5-5');
    if (onOpus < fableCost) {
      out.push({
        id: 'model-choice',
        severity: 'info',
        title: `Fable requests would cost ${usd(onOpus)} on Opus 5.5 instead of ${usd(fableCost)}`,
        detail: `Same token counts, Opus 5.5 list prices. Fable earns its price on the hardest reasoning; routine edits, searches and refactors rarely need it.`,
        impactUSD: fableCost - onOpus,
        sessionId: d.id,
      });
    }
  }

  // 10. Compactions.
  const auto = d.compactionEvents.filter((c) => c.trigger === 'auto').length;
  if (auto >= 2) {
    out.push({
      id: 'compactions',
      severity: 'low',
      title: `Context filled up and auto-compacted ${auto} times`,
      detail: `Each compaction summarizes and rebuilds the cache, and details from before it can be lost. Long-running sessions are often several tasks that would be cheaper as separate sessions.`,
      sessionId: d.id,
    });
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.impactUSD ?? 0) - (a.impactUSD ?? 0));
}

export function globalInsights(
  o: Overview,
  extra: { bigContextCost: number; rebuildBySession: Map<string, number>; sessions: SessionSummary[] },
): Insight[] {
  const out: Insight[] = [];
  const total = o.totals.cost.total;
  if (total <= 0) return out;
  const byId = new Map(extra.sessions.map((s) => [s.id, s]));

  if (o.totals.cacheRebuildCost >= 1) {
    const [topId, topCost] = [...extra.rebuildBySession.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    const top = topId ? byId.get(topId) : undefined;
    out.push({
      id: 'g-cache-rebuild',
      severity: severityByShare(o.totals.cacheRebuildCost / total, o.totals.cacheRebuildCost),
      title: `${usd(o.totals.cacheRebuildCost)} went to rebuilding the prompt cache`,
      detail:
        `Resuming sessions after long breaks and switching models mid-session re-write the whole context at the cache-write price.` +
        (top ? ` Largest: “${top.title}” (${usd(topCost!)}).` : ''),
      impactUSD: o.totals.cacheRebuildCost,
      sessionId: top?.id,
      projectId: top?.projectId,
    });
  }

  if (extra.bigContextCost / total >= 0.25) {
    out.push({
      id: 'g-big-context',
      severity: extra.bigContextCost / total >= 0.5 ? 'high' : 'medium',
      title: `${pct(extra.bigContextCost / total)} of spend came from requests carrying 200K+ tokens`,
      detail: `Very long sessions get more expensive per request. Starting a fresh session per task, or compacting at checkpoints, is the biggest lever on this number.`,
      impactUSD: extra.bigContextCost,
    });
  }

  const fable = Object.entries(o.usageByModel).filter(([m]) => resolvePrice(m)?.price.family === 'fable');
  const fableCost = fable.reduce((a, [m]) => a + (o.costByModel[m] ?? 0), 0);
  if (fableCost / total >= 0.25 && fableCost >= 5) {
    const opus = MODEL_PRICES.find((m) => m.id === 'claude-opus-5-5')!;
    const onOpus = fable.reduce((a, [, u]) => a + costOf(u, opus.rates).total, 0);
    out.push({
      id: 'g-model',
      severity: 'info',
      title: `Fable is ${pct(fableCost / total)} of spend — ${usd(fableCost - onOpus)} less on Opus 5.5`,
      detail: `${usd(fableCost)} on Fable models; the same tokens at Opus 5.5 list prices would be ${usd(onOpus)}. Worth it for the hardest problems; consider /model opus for routine work.`,
      impactUSD: fableCost - onOpus,
    });
  }

  const carry = o.toolStats.filter((t) => t.carryCost > 0).sort((a, b) => b.carryCost - a.carryCost);
  if (carry.length && carry[0].carryCost >= 2) {
    const top = carry.slice(0, 3);
    out.push({
      id: 'g-tool-carry',
      severity: 'medium',
      title: `Tool output kept in context cost ~${usd(carry.reduce((a, t) => a + t.carryCost, 0))}`,
      detail: `Biggest contributors: ${top.map((t) => `${t.name} ~${usd(t.carryCost)} (${t.calls} calls)`).join(', ')}. Everything a tool returns is re-read on every later request until the context is compacted or cleared.`,
      impactUSD: carry.reduce((a, t) => a + t.carryCost, 0),
    });
  }

  if (o.totals.subagentCost / total >= 0.2) {
    out.push({
      id: 'g-subagents',
      severity: 'info',
      title: `Subagents: ${pct(o.totals.subagentCost / total)} of spend (${usd(o.totals.subagentCost)})`,
      detail: `Subagent runs start with their own context. Useful for parallel research, but cheap lookups are often faster in the main thread.`,
      impactUSD: o.totals.subagentCost,
    });
  }

  const topProject = o.projects[0];
  if (topProject && o.projects.length > 1 && topProject.cost.total / total >= 0.4) {
    out.push({
      id: 'g-project',
      severity: 'info',
      title: `${topProject.name} accounts for ${pct(topProject.cost.total / total)} of spend`,
      detail: `${usd(topProject.cost.total)} across ${topProject.sessionCount} sessions.`,
      impactUSD: topProject.cost.total,
      projectId: topProject.id,
    });
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.impactUSD ?? 0) - (a.impactUSD ?? 0));
}

