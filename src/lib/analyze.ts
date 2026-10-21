import { modelLabel, PRICING_AS_OF, resolvePrice } from '../../shared/pricing';
import type { Prompt, SessionDetail, Step } from '../../shared/types';
import { duration, homeRelative, pct, tokens, usd } from './format';

export interface AnalyzeOptions {
  includePromptText: boolean;
  includeToolDetails: boolean;
  maskHome: boolean;
  /** 0 = all prompts. Otherwise the N most expensive, shown in session order. */
  promptLimit: number;
}

export const DEFAULT_ANALYZE: AnalyzeOptions = {
  includePromptText: true,
  includeToolDetails: true,
  maskHome: true,
  promptLimit: 0,
};

const PROMPT_CHARS = 700;

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function topTools(counts: Record<string, number>, n = 4): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}×${v}`)
    .join(', ');
}

function stepsOf(p: Prompt): Step[] {
  return [...p.steps, ...p.subagents.flatMap((r) => r.steps)];
}

export function buildAnalysis(d: SessionDetail & { projectPath?: string }, o: AnalyzeOptions): string {
  const clean = (s: string) => (o.maskHome ? homeRelative(s).replace(/\/Users\/[^/\s]+/g, '~') : s);
  const total = d.cost.total || 1;
  const all = d.prompts.flatMap(stepsOf);
  const mainSteps = d.prompts.flatMap((p) => p.steps);
  const avgCtx = mainSteps.length ? mainSteps.reduce((a, s) => a + s.contextTokens, 0) / mainSteps.length : 0;
  const promptTokens = d.usage.input + d.usage.cacheRead + d.usage.cacheWrite5m + d.usage.cacheWrite1h;
  const L: string[] = [];

  L.push('# Claude Code session — cost review request');
  L.push('');
  L.push(
    'You are an expert in getting good results from Claude Code at a reasonable cost. Below is a structured export of one Claude Code session: ' +
      'every user prompt, the API calls it triggered, the tools used, and the estimated cost of each call at Anthropic API list prices. ' +
      'Costs are estimates computed from the token usage recorded in the local transcript.',
  );
  L.push('');
  L.push('Please analyze it and answer:');
  L.push('1. **Where did the money go?** The few prompts / patterns that explain most of the spend, and why.');
  L.push('2. **What went wrong or was wasteful?** e.g. vague prompts that caused long exploration loops, re-reading files, huge tool outputs kept in context, cache rebuilds after idle gaps or model switches, unnecessary subagents, interrupted or redone work, a model more expensive than the task needed.');
  L.push('3. **What should I do differently?** Concrete, specific changes: how to phrase prompts, CLAUDE.md rules worth adding, when to /clear or /compact, model choice, tool/permission setup. Reference prompt numbers.');
  L.push('4. **Estimated impact** of each recommendation (rough $ or % of this session).');
  L.push('5. Anything that went **well** and is worth keeping.');
  L.push('');
  L.push('Be direct and specific to this session; skip generic advice.');
  L.push('');

  L.push('## Session');
  L.push(`- Title: ${clean(d.title)}`);
  if (d.projectPath || d.cwd) L.push(`- Project: ${clean(d.projectPath || d.cwd)}`);
  if (d.gitBranch) L.push(`- Git branch: ${d.gitBranch}`);
  L.push(`- Time: ${d.start} → ${d.end} (active ${duration(d.activeMs)})`);
  if (d.version) L.push(`- Claude Code version: ${d.version}`);
  L.push(`- Models: ${Object.entries(d.costByModel).sort((a, b) => b[1] - a[1]).map(([m, c]) => `${modelLabel(m)} ${usd(c)} (${pct(c / total)})`).join(', ')}`);
  L.push(`- **Estimated cost: ${usd(d.cost.total)}** — cache read ${usd(d.cost.cacheRead)} (${pct(d.cost.cacheRead / total)}), cache write ${usd(d.cost.cacheWrite)} (${pct(d.cost.cacheWrite / total)}), output ${usd(d.cost.output)} (${pct(d.cost.output / total)}), uncached input ${usd(d.cost.input)}`);
  L.push(`- Prompts: ${d.promptCount} · API calls: ${d.stepCount} · Subagent runs: ${d.subagentCount} (${usd(d.subagentCost)})`);
  L.push(`- Tokens: ${tokens(promptTokens)} prompt tokens processed (${pct(d.usage.cacheRead / Math.max(1, promptTokens))} served from cache), ${tokens(d.usage.output)} output`);
  L.push(`- Context: average ${tokens(avgCtx)} tokens per call, peak ${tokens(d.peakContext)}; ${d.compactions} compaction${d.compactions === 1 ? '' : 's'}`);
  L.push(`- Cache rebuilds (whole context re-written instead of read): ${d.cacheRebuilds}, costing ~${usd(d.cacheRebuildCost)} more than cache reads would have`);
  if (d.reported) L.push(`- Claude Code's own counter for its last run: ${usd(d.reported.totalUSD)} (includes background calls not in the transcript)`);
  L.push('');

  const models = Object.keys(d.costByModel);
  L.push(`## Prices used (USD per million tokens, list prices as of ${PRICING_AS_OF})`);
  L.push('| model | input | cache write 5m | cache write 1h | cache read | output |');
  L.push('|---|---|---|---|---|---|');
  for (const m of models) {
    const r = resolvePrice(m)?.price.rates;
    if (r) L.push(`| ${modelLabel(m)} | ${r.input} | ${r.write5m} | ${r.write1h} | ${r.read} | ${r.output} |`);
  }
  L.push('');

  if (d.insights.length) {
    L.push('## Automated findings (heuristics — verify them)');
    for (const i of d.insights) L.push(`- [${i.severity}] ${clean(i.title)}. ${clean(i.detail)}`);
    L.push('');
  }

  let prompts = d.prompts;
  if (o.promptLimit > 0 && prompts.length > o.promptLimit) {
    const keep = new Set([...prompts].sort((a, b) => b.cost.total - a.cost.total).slice(0, o.promptLimit).map((p) => p.index));
    prompts = prompts.filter((p) => keep.has(p.index));
  }

  L.push('## Prompt timeline');
  if (prompts.length < d.prompts.length) L.push(`_Showing the ${prompts.length} most expensive of ${d.prompts.length} prompts, in order._`);
  L.push('| # | kind | calls | subagents | duration | peak context | cost | share | main tools |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const p of prompts) {
    L.push(
      `| ${p.index} | ${p.kind}${p.interrupted ? ' (interrupted)' : ''} | ${stepsOf(p).length} | ${p.subagents.length} | ${duration(p.durationMs)} | ${tokens(p.peakContext)} | ${usd(p.cost.total)} | ${pct(p.cost.total / total)} | ${esc(topTools(p.toolCounts))} |`,
    );
  }
  L.push('');

  L.push('## Prompts in detail');
  for (const p of prompts) {
    const calls = stepsOf(p);
    L.push(`### #${p.index} — ${usd(p.cost.total)} (${pct(p.cost.total / total)}), ${calls.length} API calls`);
    if (o.includePromptText) {
      const text = clean(p.text);
      L.push('> ' + (text.length > PROMPT_CHARS ? text.slice(0, PROMPT_CHARS) + ' …[truncated]' : text).replace(/\n+/g, '\n> '));
    } else {
      L.push(`> (${p.kind}, ${p.text.length} characters — text omitted)`);
    }
    const rebuilds = p.steps.filter((s) => s.cacheRebuild && s.rebuildReason !== 'first');
    if (rebuilds.length) {
      L.push(`- Cache rebuilds: ${rebuilds.map((s) => `${s.rebuildReason}${s.gapMinutes && s.gapMinutes > 5 ? ` after ${Math.round(s.gapMinutes)} min idle` : ''} (${tokens(s.usage.cacheWrite1h + s.usage.cacheWrite5m)} tokens written)`).join('; ')}`);
    }
    if (o.includeToolDetails) {
      const byTool = new Map<string, string[]>();
      for (const s of p.steps) for (const t of s.tools) byTool.set(t.name, [...(byTool.get(t.name) ?? []), clean(t.summary)]);
      for (const [name, items] of byTool) {
        const uniq = [...new Set(items.filter(Boolean))];
        L.push(`- ${name} ×${items.length}${uniq.length ? `: ${uniq.slice(0, 6).map((x) => `\`${x.slice(0, 90)}\``).join(', ')}${uniq.length > 6 ? ` +${uniq.length - 6} more` : ''}` : ''}`);
      }
      const heavy = p.steps.flatMap((s) => s.tools).filter((t) => t.resultChars > 20_000);
      if (heavy.length) L.push(`- Large tool results: ${heavy.map((t) => `${t.name} ${clean(t.summary).slice(0, 60)} (~${tokens(t.resultChars / 3.5)} tokens)`).join('; ')}`);
    } else if (Object.keys(p.toolCounts).length) {
      L.push(`- Tools: ${topTools(p.toolCounts, 8)}`);
    }
    for (const r of p.subagents) {
      L.push(`- Subagent **${r.agentType}**${r.description ? ` “${clean(r.description)}”` : ''}: ${r.steps.length} calls, ${usd(r.cost.total)}, tools ${topTools(r.toolCounts)}`);
    }
    L.push('');
  }

  L.push('## Most expensive API calls');
  L.push('| prompt | model | context | cache write | output | cost | tools |');
  L.push('|---|---|---|---|---|---|---|');
  const idx = new Map<Step, number>();
  for (const p of d.prompts) for (const s of stepsOf(p)) idx.set(s, p.index);
  for (const s of [...all].sort((a, b) => b.cost.total - a.cost.total).slice(0, 12)) {
    const tools = s.tools.map((t) => (o.includeToolDetails && t.summary ? `${t.name}(${clean(t.summary).slice(0, 40)})` : t.name)).join(', ');
    L.push(`| #${idx.get(s)} | ${modelLabel(s.model)} | ${tokens(s.contextTokens)} | ${tokens(s.usage.cacheWrite1h + s.usage.cacheWrite5m)} | ${tokens(s.usage.output)} | ${usd(s.cost.total)} | ${esc(tools)} |`);
  }
  L.push('');

  if (d.toolStats.length) {
    L.push('## Tool usage');
    L.push('| tool | calls | errors | output returned | est. cost to keep in context |');
    L.push('|---|---|---|---|---|');
    for (const t of d.toolStats.slice(0, 15)) {
      L.push(`| ${t.name} | ${t.calls} | ${t.errors} | ~${tokens(t.resultChars / 3.5)} tokens | ${usd(t.carryCost)} |`);
    }
    L.push('');
  }

  L.push('---');
  L.push('Notes on the data: "cache read" is the context re-sent on every call and served from the prompt cache; "cache write" is new context (or the whole context after a cache expiry) written to the cache. Claude Code uses a 1-hour cache. Context-carry cost is an estimate (~3.5 characters per token).');
  return L.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
