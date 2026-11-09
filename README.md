# Turnbill

**English** · [Türkçe](README.tr.md) · [Español](README.es.md)

See what your Claude Code usage costs, down to every prompt and API call. Turnbill reads the transcripts Claude Code already keeps on your machine and prices them at Anthropic's API list prices. It also shows why a prompt was expensive.

<p align="center">
  <img src="docs/media/demo.gif" alt="Turnbill demo: run npx turnbill, open a project, open a session, expand the most expensive prompt to see each API call, then copy a cost review" width="800">
</p>
<p align="center"><a href="docs/media/demo.mp4?raw=true">Download the full-quality video (MP4, 5 MB)</a> · The demo uses made-up data.</p>

## Quick start

```bash
npx turnbill
```

Then open http://localhost:4317. Requires Node.js 20 or later. Nothing is uploaded: the server only listens on `127.0.0.1`.

| Flag | Default | |
|---|---|---|
| `--port` | `4317` (or `$PORT`) | Port to listen on |
| `--dir` | `$CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects` | Where Claude Code keeps transcripts |
| `--open` | off | Open the browser |

## What you get

**Overview.** API-equivalent spend for the selected range, split into cache reads, cache writes, output and input. It also shows how much prompt caching saved, spend per active day, and a month-end projection. Then it lists your projects by spend, a daily chart by model, a day × hour heatmap, your most expensive sessions and prompts, and the sessions running right now. With a Pro or Max plan set, it compares your usage with what you pay.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/overview-dark.png">
  <img alt="Overview page: spend for the last 30 days by token type, with projects ranked by cost" src="docs/media/overview-light.png">
</picture>

**Project.** Every session started in a directory, with active time, prompts, API calls, models and cost. You can filter, sort and export the list as CSV.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/project-dark.png">
  <img alt="Project page: daily spend and the list of sessions in one project" src="docs/media/project-light.png">
</picture>

**Session.**
- A cost-per-prompt chart. Click a bar to jump to that prompt.
- Context size and cost for every call, with cache rebuilds and compactions marked.
- A cross-check against Claude Code's own cost counter.
- Insights, and the same tokens priced on other models.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/session-dark.png">
  <img alt="Session page: cost per prompt, where the money went, and context size per API call" src="docs/media/session-light.png">
</picture>

**Prompt → API calls.** Expand a prompt to see every API call it caused:
- the tools it ran (files, commands, search patterns) and the size of their output
- context size
- cost by token type

Subagent runs are nested inside. Cache rebuilds explain themselves, for example "after 1.3h idle — 311K tokens re-written".

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/prompt-dark.png">
  <img alt="An expanded prompt showing each API call with its tools, context size and cost; the first call is a cache rebuild after an idle gap" src="docs/media/prompt-light.png">
</picture>

**Analyze.** Copies a structured cost review of a session, with instructions, so you can paste it into Claude, ChatGPT or any other assistant and ask what went wrong and what to change. You choose whether to include prompt text and tool details and whether to mask your home directory, and you see a preview before copying.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/analyze-dark.png">
  <img alt="Analyze dialog with privacy options and a preview of the text that will be copied" src="docs/media/analyze-light.png">
</picture>

**Insights.** Heuristics that put a dollar amount on common waste:
- cache rebuilds after idle gaps or model switches
- very large contexts
- large tool outputs that stay in context
- files read over and over
- outlier prompts
- interrupted work
- subagent share
- tool failures
- Fable usage that Opus would cover

Also: search across prompts, file paths and commands (⌘K), CSV and JSON export, light and dark themes, and a page that documents the pricing and method.

## How costs are computed

- **Hierarchy.**
  - A **project** is the directory Claude Code was started in.
  - A **session** is one transcript. `/clear` starts a new one.
  - A **prompt** is a message you sent, a slash command or a background-task notification, plus everything it triggered.
  - An **API call** is one model request. One call can run several tools.
- **De-duplication.** Claude Code writes one response as several transcript lines. Lines are grouped by API message id, and the final usage is kept.
- **Price per call.** The formula is below. Cache-read multipliers differ by model. Fast mode, Haiku 5.5's prompt-length tier, Sonnet 4/4.5 long context and US data residency are applied when the transcript shows them.

  ```
  input × input price
  + cache reads × cache-read price
  + 5m/1h cache writes × write price
  + output × output price
  + web searches
  ```
- **Subagents** come from `<session>/subagents/*.jsonl`. Each run is attached to the prompt that was active when it ran.
- **Refusal fallbacks.** When a safety classifier declined a request and Claude Code retried on another model, every attempt is priced on its own model. Billing follows [Anthropic's rules](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#how-refusals-are-billed).
- **Prices** live in [`shared/pricing.ts`](shared/pricing.ts). Source: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), as of 2026-10-21.

### Accuracy

Some billed requests never reach the transcript: session titles, away summaries, compaction, and the WebSearch/WebFetch tools' own model calls. Estimates therefore run a little low.

Claude Code also keeps its own cost counter for the latest run of a session, and Turnbill compares against it. On the author's machine, across 65 sessions, Turnbill came to **89%** of that counter. You can run the same check on your machine with `npm run calibrate`.

A run that ends without saving the counter (for example, when the terminal is closed) drops out of it. Turnbill marks those sessions "not comparable" instead of showing a misleading percentage.

### Keep more history

Claude Code deletes local transcripts after 30 days by default. To see a longer history, raise `cleanupPeriodDays` in `~/.claude/settings.json`:

```json
{ "cleanupPeriodDays": 365 }
```

## Privacy

- The server binds to `127.0.0.1`. It rejects requests that aren't addressed to localhost, which also blocks DNS rebinding.
- Transcripts are read, never modified, and never uploaded.
- The only network requests are for Google Fonts. Without a connection, the UI uses system fonts.
- Analyze only copies text to your clipboard.

## Development

```bash
npm install
npm run dev          # Vite dev server with the API, http://localhost:5173
npm run demo         # build, generate made-up transcripts in .demo/, serve them
npm test             # parser, pricing and store tests
npm run typecheck
npm run calibrate    # compare estimates with Claude Code's own counter, per session
```

```
server/   parser.ts (transcript → sessions/prompts/calls), store.ts (scan, cache, aggregates),
          insights.ts, api.ts, index.ts (production server)
shared/   pricing.ts, types.ts (shared by server and client)
src/      React app: pages/, components/, lib/
scripts/  demo-data.ts (synthetic transcripts), calibrate.ts
bin/      turnbill CLI
```

Issues and pull requests are welcome. When prices change, update `shared/pricing.ts` and the `PRICING_AS_OF` date.

## Disclaimer

Turnbill is an independent project. It is not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC. All costs are estimates at public API list prices. Your invoice, or what a subscription plan covers, can differ.

## License

[MIT](LICENSE)
