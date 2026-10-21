import { MODEL_PRICES, PRICING_AS_OF, PRICING_SOURCE, WEB_SEARCH_USD } from '../../shared/pricing';
import type { DataStatus } from '../../shared/types';
import { Card, CardHeader } from '../components/ui';
import { useApi } from '../lib/api';
import { pct, usd } from '../lib/format';

const fmt = (n: number) => (n < 0.1 ? `$${n.toFixed(3)}` : n < 1 ? `$${n.toFixed(2)}` : `$${Number.isInteger(n) ? n : n.toFixed(2)}`);

export default function Method() {
  const { data: status } = useApi<DataStatus>('/api/status');
  const c = status?.calibration;
  return (
    <div className="space-y-4">
      <div className="rise">
        <h1 className="text-[22px] font-semibold tracking-tight">Pricing & method</h1>
        <p className="text-[13px] text-fg-3">How Tokenscope turns local transcripts into dollar estimates, and where those estimates fall short.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7" i={1}>
          <CardHeader title="How costs are computed" />
          <div className="space-y-3 px-5 pb-5 text-[13px] leading-relaxed text-fg-2">
            <p>
              Claude Code writes every session to <span className="font-mono text-fg">~/.claude/projects/&lt;project&gt;/&lt;session&gt;.jsonl</span>, and subagent runs to a
              <span className="font-mono text-fg"> subagents/</span> folder next to it. Each API response in those files records its token usage.
            </p>
            <p>
              <span className="font-medium text-fg">Hierarchy.</span> A <em>project</em> is the directory Claude Code was started in. A <em>session</em> is one transcript —
              <span className="font-mono"> /clear</span> starts a new one. A <em>prompt</em> is a message you sent (or a slash command, or a background-task notification) plus
              everything it triggered. An <em>API call</em> is one request to the model; a single call can run several tools in parallel, and each tool result goes back in the
              next call.
            </p>
            <p>
              <span className="font-medium text-fg">Per call,</span> the cost is: uncached input × input price + cache reads × cache-read price + cache writes × the 5-minute
              or 1-hour write price + output × output price (+ ${WEB_SEARCH_USD.toFixed(2)} per web search). Claude Code writes a single response as several transcript lines, so
              lines are de-duplicated by API message id and the final usage is kept.
            </p>
            <p>
              <span className="font-medium text-fg">Cache rebuild</span> marks a call that wrote most of its context to the cache instead of reading it — typically the first
              call after the 1-hour cache expired, after a model switch, or after compaction. The “extra” shown is what those tokens cost above the cache-read price.
            </p>
            <p>
              <span className="font-medium text-fg">Carry cost</span> estimates what a tool result cost by staying in context: its size (~3.5 characters per token) written
              once and then re-read on every later call until the next compaction.
            </p>
          </div>
        </Card>
        <Card className="lg:col-span-5" i={2}>
          <CardHeader title="Known gaps" />
          <ul className="list-disc space-y-2 pr-5 pb-5 pl-9 text-[13px] leading-relaxed text-fg-2">
            <li>
              <span className="text-fg">Background requests</span> — session titles, away summaries, compaction and some classifier calls — are billed but not written to
              the transcript, so totals run a little low.
              {c && c.sessions > 0 && (
                <>
                  {' '}
                  Across {c.sessions} of your sessions where Claude Code also kept its own counter, Tokenscope’s estimate came to{' '}
                  <span className="num text-fg">{pct(c.estimatedUSD / c.reportedUSD, 1)}</span> of it ({usd(c.estimatedUSD)} vs {usd(c.reportedUSD)}).
                </>
              )}
            </li>
            <li>
              Claude Code’s <span className="font-mono">WebSearch</span> and <span className="font-mono">WebFetch</span> tools make their own model requests (and web
              searches cost $10 per 1,000); those requests are not in the transcript either.
            </li>
            <li>Prices are Anthropic first-party API list prices. Bedrock, Vertex and negotiated discounts differ; batch discounts don’t apply to Claude Code.</li>
            <li>On Pro and Max plans you pay a subscription, not these amounts — the figures show the API-equivalent value of your usage.</li>
            <li>When a refusal fell back to another model, the fallback’s usage is priced; the refused attempt is not.</li>
            <li>Unknown model ids are priced at the newest model of the same family and flagged in the data.</li>
          </ul>
        </Card>
      </div>

      <Card i={3}>
        <CardHeader
          title="Price table"
          subtitle={
            <>
              USD per million tokens, as of {PRICING_AS_OF}. Source:{' '}
              <a href={PRICING_SOURCE} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2">
                Anthropic pricing
              </a>
            </>
          }
        />
        <div className="scroll-x">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead>
              <tr className="border-y border-line bg-surface-2/50">
                {['Model', 'Input', 'Cache write 5m', 'Cache write 1h', 'Cache read', 'Output', 'Notes'].map((h, i) => (
                  <th key={h} className={`eyebrow px-4 py-2 font-normal ${i > 0 && i < 6 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODEL_PRICES.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2">
                    <div className="text-fg">{m.label}</div>
                    <div className="font-mono text-[11px] text-fg-3">{m.id}</div>
                  </td>
                  <td className="num px-4 py-2 text-right">{fmt(m.rates.input)}</td>
                  <td className="num px-4 py-2 text-right">{fmt(m.rates.write5m)}</td>
                  <td className="num px-4 py-2 text-right">{fmt(m.rates.write1h)}</td>
                  <td className="num px-4 py-2 text-right">{fmt(m.rates.read)}</td>
                  <td className="num px-4 py-2 text-right">{fmt(m.rates.output)}</td>
                  <td className="px-4 py-2 text-[12px] text-fg-3">
                    {[
                      m.fast && `Fast mode ${fmt(m.fast.input)} / ${fmt(m.fast.output)}`,
                      m.longContext && `Prompts over ${m.longContext.threshold / 1000}K: ${fmt(m.longContext.rates.input)} / ${fmt(m.longContext.rates.output)}`,
                      m.geoMultiplier && 'US-only inference ×1.1',
                      m.historical && 'Historical price',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
