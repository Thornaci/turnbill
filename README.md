# Tokenscope

A local dashboard that shows what your Claude Code usage costs. It covers every project, every session, every prompt and every API call, priced at Anthropic's current API list prices.

Claude Code keeps a transcript of each session in `~/.claude/projects`. Tokenscope reads those files, de-duplicates them into billable requests and shows where the money went. It also shows what to change.

## Quick start

```bash
npm install
npm run build
npm start            # http://localhost:4317
```

For development (hot reload, API served by the Vite dev server):

```bash
npm run dev          # http://localhost:5173
```

Options for `npm start` / `bin/tokenscope.js`:

| Flag | Default | |
|---|---|---|
| `--port` | `4317` (or `$PORT`) | Port to listen on |
| `--dir` | `$CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects` | Where Claude Code transcripts live |
| `--open` | off | Open the browser |

## What you get

- **Overview.** API-equivalent spend for the selected range, broken into cache read, cache write, output and input. It shows how much prompt caching saved, spend per active day, the busiest day and a month-end projection. With a Pro or Max plan set, it also compares usage with what you pay. Then:
  - Projects, sorted by spend
  - Daily spend by model
  - A day × hour heatmap
  - The most expensive sessions and prompts
  - Tools ranked by the cost of keeping their output in context
  - Sessions running right now
- **Project.** Every session in the directory, with active time, prompt and call counts, models and cost. You can filter, sort and export the list as CSV.
- **Session.**
  - **Cost per prompt chart.** Click a bar to jump to that prompt.
  - **Per-call charts.** Context size and cost per call, with cache rebuilds and compactions marked.
  - **Prompt timeline.** Expand a prompt to see each API call: tools used (files, commands, patterns), token mix, context size, cost. Subagent runs are nested inside.
  - **Cross-check.** Compares the estimate with Claude Code's own cost counter when the transcript has one.
  - **Exports.** CSV per prompt or per call, plus JSON.
- **Analyze.** Copies a structured cost review of a session, with instructions, so you can paste it into Claude, ChatGPT or any assistant and ask what went wrong and what to change. You can switch prompt text, tool details and home-directory masking on or off, and you see a preview before copying.
- **Insights.** Heuristics that put a dollar amount on common waste:
  - Cache rebuilds after idle gaps or model switches
  - Very large contexts
  - Big tool outputs that stay in context
  - Files read over and over
  - Outlier prompts
  - Interrupted work
  - Subagent share
  - Tool failures
  - Fable usage that Opus would cover
- **What-if.** The same token counts priced on other models.
- **Search** (⌘K). Search prompts, titles, file paths, commands and grep patterns across all sessions.
- **Pricing & method.** The full price table, how each number is computed, and the known gaps.

## How costs are computed

- **Hierarchy.**
  - A **project** is the directory Claude Code was started in.
  - A **session** is one transcript; `/clear` starts a new one.
  - A **prompt** is a message you sent, a slash command or a background-task notification, plus everything it triggered.
  - An **API call** is one model request. One call can run several tools in parallel.
- **De-duplication.** Claude Code writes one response as several transcript lines. Lines are grouped by API message id, and the final usage is kept.
- **Price per call.**
  ```
  input × input price
  + cache reads × cache-read price
  + 5m/1h cache writes × write price
  + output × output price
  + web searches
  ```
  - Cache-read multipliers differ by model (0.025× on Fable 5.1, 0.05× on Opus 5.5 and Sonnet 5.5, 0.1× elsewhere).
  - Fast mode, Haiku 5.5's prompt-length tier, Sonnet 4/4.5 long context and US data residency are applied when the transcript shows them.
- **Subagents** come from `<session>/subagents/*.jsonl`. Each part is attached to the prompt that was active when it ran, so a subagent resumed by a later prompt is split.
- **Refusal fallbacks.** When a safety classifier declined a request and Claude Code retried on another model, every attempt in `usage.iterations` is priced on its own model.
  - An attempt that declined mid-stream is billed.
  - An attempt that declined before any output is billed only in the `bio`, `frontier_llm` and `reasoning_extraction` categories, [per Anthropic's rules](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#how-refusals-are-billed).
- **Prices** are in [`shared/pricing.ts`](shared/pricing.ts). Source: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), as of 2026-10-21.

**Accuracy.** Some background requests are billed but never written to the transcript: session titles, away summaries, compaction, and the WebSearch/WebFetch tools' own model calls. Estimates therefore run a little low. `npm run calibrate` compares Tokenscope with Claude Code's own cost counter. On the author's machine it was 89% of that counter across 76 sessions, and usually 93–100% for short sessions.

## Privacy

- The server binds to `127.0.0.1` and rejects requests that aren't addressed to localhost, which protects against DNS rebinding.
- Transcripts are read, never modified, and nothing is uploaded.
- The only network requests are to Google Fonts. The UI falls back to system fonts when offline.
- Analyze only copies text to your clipboard.

## Development

```bash
npm test             # parser, pricing and store tests (vitest)
npm run typecheck
npm run calibrate    # estimate vs Claude Code's own counter, per session
```

Layout:

```
server/   parser.ts (transcript → sessions/prompts/calls), store.ts (scan, cache, aggregates),
          insights.ts, api.ts, index.ts (production server)
shared/   pricing.ts, types.ts (used by server and client)
src/      React app: pages/, components/, lib/
bin/      tokenscope.js CLI
```
