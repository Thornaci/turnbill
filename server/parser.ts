import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import {
  addCost,
  addUsage,
  priceRequest,
  promptTokens,
  ratesFor,
  resolvePrice,
  zeroCost,
  zeroUsage,
} from '../shared/pricing';
import { isAvoidableRebuild } from '../shared/steps';
import type {
  CompactionEvent,
  Prompt,
  PromptKind,
  ReportedCost,
  SessionDetail,
  Step,
  SubagentRun,
  ToolCall,
  ToolStat,
  Usage,
} from '../shared/types';

/** Rough chars-per-token ratio for code and prose; used only for context-carry estimates. */
export const CHARS_PER_TOKEN = 3.5;
/** Token cost attributed to an image in a tool result when its size is unknown. */
const IMAGE_CHARS = 1600 * CHARS_PER_TOKEN;
const MAX_PROMPT_CHARS = 20_000;
const REBUILD_MIN_TOKENS = 20_000;

type Json = Record<string, any>;

interface StepBuilder {
  step: Step;
  promptId: string;
  order: number;
  geo: string | null;
  toolIds: Set<string>;
  /** Older Claude Code versions wrote subagent turns into the main file. */
  sidechain: boolean;
  requestId: string | null;
  /** `usage.iterations` from the final streamed line: one entry per attempt (refusal fallback, compaction). */
  iterations: Json[] | null;
  /** Earlier attempts of this request, priced separately. */
  attempts: Step[];
}

/**
 * Refusal categories billed even when the attempt declined before any output
 * (https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#how-refusals-are-billed).
 */
const BILLED_REFUSAL_CATEGORIES = new Set(['bio', 'frontier_llm', 'reasoning_extraction']);

interface ThreadResult {
  steps: StepBuilder[];
  toolResults: Map<string, { chars: number; isError: boolean }>;
}

export interface SessionFiles {
  id: string;
  projectId: string;
  mainFile: string;
  subagentFiles: { file: string; metaFile: string | null }[];
}

export interface ParseOptions {
  liveWindowMs?: number;
  mtimeMs?: number;
  fileBytes?: number;
  now?: number;
}

async function* readJsonLines(file: string): AsyncGenerator<Json> {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    // Request blobs and file snapshots are large and carry nothing we price.
    if (line.startsWith('{"type":"api-request') || line.startsWith('{"type":"file-history')) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A partially written last line of a live session; skip it.
    }
  }
}

export function extractUsage(u: Json | undefined): Usage {
  const usage = zeroUsage();
  if (!u) return usage;
  usage.input = num(u.input_tokens);
  usage.cacheRead = num(u.cache_read_input_tokens);
  usage.output = num(u.output_tokens);
  const creation = num(u.cache_creation_input_tokens);
  const cc = u.cache_creation;
  if (cc && typeof cc === 'object') {
    usage.cacheWrite5m = num(cc.ephemeral_5m_input_tokens);
    usage.cacheWrite1h = num(cc.ephemeral_1h_input_tokens);
    const missing = creation - usage.cacheWrite5m - usage.cacheWrite1h;
    if (missing > 0) usage.cacheWrite5m += missing;
  } else {
    usage.cacheWrite5m = creation;
  }
  usage.webSearches = num(u.server_tool_use?.web_search_requests);
  return usage;
}

function maxUsage(a: Usage, b: Usage): Usage {
  return {
    input: Math.max(a.input, b.input),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite5m: Math.max(a.cacheWrite5m, b.cacheWrite5m),
    cacheWrite1h: Math.max(a.cacheWrite1h, b.cacheWrite1h),
    output: Math.max(a.output, b.output),
    webSearches: Math.max(a.webSearches, b.webSearches),
  };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function oneLine(s: string, n: number): string {
  return truncate(s.replace(/\s+/g, ' ').trim(), n);
}

function relPath(p: unknown, cwd: string): string {
  if (typeof p !== 'string') return '';
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1);
  return p;
}

export function summarizeTool(name: string, input: Json | undefined, cwd: string): string {
  const i = input ?? {};
  switch (name) {
    case 'Bash':
      return oneLine(String(i.command ?? i.description ?? ''), 160);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return relPath(i.file_path ?? i.notebook_path, cwd);
    case 'Grep':
      return oneLine(`${i.pattern ?? ''}${i.path ? `  in ${relPath(i.path, cwd)}` : ''}${i.glob ? `  (${i.glob})` : ''}`, 160);
    case 'Glob':
      return oneLine(`${i.pattern ?? ''}${i.path ? `  in ${relPath(i.path, cwd)}` : ''}`, 160);
    case 'WebFetch':
      return oneLine(String(i.url ?? ''), 160);
    case 'WebSearch':
    case 'web_search':
      return oneLine(String(i.query ?? ''), 160);
    case 'Agent':
    case 'Task':
      return oneLine(`${i.subagent_type ?? 'agent'}: ${i.description ?? ''}`, 160);
    case 'Skill':
      return oneLine(String(i.skill ?? i.name ?? ''), 120);
    case 'TodoWrite':
      return Array.isArray(i.todos) ? `${i.todos.length} todos` : '';
    default: {
      const first = Object.values(i).find((v) => typeof v === 'string' && v.length > 0);
      return typeof first === 'string' ? oneLine(relPath(first, cwd) || first, 140) : '';
    }
  }
}

function toolResultChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') n += block.text.length;
    else if (block?.type === 'image') n += IMAGE_CHARS;
    else if (block && typeof block === 'object') n += JSON.stringify(block).length;
  }
  return n;
}

function userText(content: unknown): { text: string; images: number } {
  if (typeof content === 'string') return { text: content, images: 0 };
  if (!Array.isArray(content)) return { text: '', images: 0 };
  const parts: string[] = [];
  let images = 0;
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block?.type === 'image') images++;
  }
  return { text: parts.join('\n'), images };
}

function parseCommand(text: string): { command: string; args: string } | null {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim();
  if (!name) return null;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? '';
  return { command: name.startsWith('/') ? name : `/${name}`, args };
}

interface PromptBuilder {
  prompt: Prompt;
  order: number;
}

function newPrompt(id: string, ts: string, kind: PromptKind): Prompt {
  return {
    id,
    index: 0,
    ts,
    kind,
    text: '',
    imageCount: 0,
    steps: [],
    subagents: [],
    usage: zeroUsage(),
    cost: zeroCost(),
    ownCost: 0,
    durationMs: null,
    interrupted: false,
    toolCounts: {},
    peakContext: 0,
  };
}

/**
 * Reads one transcript (main thread or subagent) and returns its billable requests,
 * deduplicated by API message id. Claude Code writes one line per content block, so a
 * single request can appear several times with partial usage.
 */
async function readThread(
  file: string,
  cwdHint: string,
  onRecord?: (rec: Json, promptIdFor: (rec: Json) => string | null) => void,
): Promise<ThreadResult> {
  const steps = new Map<string, StepBuilder>();
  const toolResults = new Map<string, { chars: number; isError: boolean }>();
  const uuidPrompt = new Map<string, string>();
  const refusalCategory = new Map<string, string | null>();
  let lastPromptId: string | null = null;
  let order = 0;
  let cwd = cwdHint;

  const promptIdFor = (rec: Json): string | null => {
    let pid: string | null = typeof rec.promptId === 'string' ? rec.promptId : null;
    if (!pid && rec.parentUuid) pid = uuidPrompt.get(rec.parentUuid) ?? null;
    if (!pid) pid = lastPromptId;
    if (pid && rec.uuid) uuidPrompt.set(rec.uuid, pid);
    if (pid) lastPromptId = pid;
    return pid;
  };

  for await (const rec of readJsonLines(file)) {
    if (!cwd && typeof rec.cwd === 'string') cwd = rec.cwd;
    onRecord?.(rec, promptIdFor);

    if (rec.type === 'user') {
      if (!onRecord) promptIdFor(rec);
      const content = rec.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            toolResults.set(block.tool_use_id, {
              chars: toolResultChars(block.content),
              isError: block.is_error === true,
            });
          }
        }
      }
      continue;
    }

    if (rec.type !== 'assistant') {
      if (rec.type === 'system' && rec.subtype === 'model_refusal_fallback' && typeof rec.requestId === 'string') {
        refusalCategory.set(rec.requestId, typeof rec.apiRefusalCategory === 'string' ? rec.apiRefusalCategory : null);
      }
      if (!onRecord && rec.uuid) promptIdFor(rec);
      continue;
    }

    const msg = rec.message;
    if (!msg || !msg.usage || msg.model === '<synthetic>') {
      if (!onRecord) promptIdFor(rec);
      continue;
    }
    const pid = onRecord ? (uuidPrompt.get(rec.uuid) ?? lastPromptId ?? '') : (promptIdFor(rec) ?? '');
    const id: string = msg.id ?? rec.requestId ?? rec.uuid;
    const usage = extractUsage(msg.usage);
    let b = steps.get(id);
    if (!b) {
      b = {
        promptId: pid,
        order: order++,
        geo: typeof msg.usage.inference_geo === 'string' ? msg.usage.inference_geo : null,
        toolIds: new Set(),
        sidechain: rec.isSidechain === true,
        requestId: null,
        iterations: null,
        attempts: [],
        step: {
          id,
          ts: rec.timestamp ?? '',
          model: String(msg.model ?? 'unknown'),
          speed: 'standard',
          geo: null,
          usage,
          cost: zeroCost(),
          contextTokens: 0,
          tools: [],
          textPreview: '',
          hasThinking: false,
          stopReason: null,
          cacheRebuild: false,
          gapMinutes: null,
        },
      };
      steps.set(id, b);
    } else {
      b.step.usage = maxUsage(b.step.usage, usage);
    }
    // The first streamed line can lack these; the final line always has them.
    if (msg.usage.speed) b.step.speed = msg.usage.speed === 'fast' ? 'fast' : 'standard';
    if (typeof msg.usage.inference_geo === 'string') b.geo = msg.usage.inference_geo;
    if (Array.isArray(msg.usage.iterations) && msg.usage.iterations.length) b.iterations = msg.usage.iterations;
    if (typeof rec.requestId === 'string') b.requestId = rec.requestId;
    if (msg.stop_reason) b.step.stopReason = msg.stop_reason;
    for (const block of Array.isArray(msg.content) ? msg.content : []) {
      if (block?.type === 'tool_use' || block?.type === 'server_tool_use') {
        if (b.toolIds.has(block.id)) continue;
        b.toolIds.add(block.id);
        b.step.tools.push({
          id: block.id,
          name: String(block.name ?? 'tool'),
          summary: summarizeTool(String(block.name ?? ''), block.input, cwd),
          resultChars: 0,
          isError: false,
          carryCost: 0,
        });
      } else if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        if (b.step.textPreview.length < 400) b.step.textPreview = truncate((b.step.textPreview + ' ' + block.text).trim(), 400);
      } else if (block?.type === 'thinking' || block?.type === 'redacted_thinking') {
        b.step.hasThinking = true;
      }
    }
  }

  const list = [...steps.values()].sort((a, b) => a.order - b.order);
  for (const b of list) {
    for (const t of b.step.tools) {
      const r = toolResults.get(t.id);
      if (r) {
        t.resultChars = r.chars;
        t.isError = r.isError;
      }
    }
    b.step.geo = b.geo;
    b.step.contextTokens = promptTokens(b.step.usage);
    b.step.cost = priceRequest(b.step.model, b.step.usage, { speed: b.step.speed, geo: b.geo });
    b.attempts = earlierAttempts(b, refusalCategory);
  }
  return { steps: list, toolResults };
}

/**
 * Top-level usage covers only the attempt that produced the message; `usage.iterations` lists
 * every attempt. Earlier attempts become their own steps so each is priced on its own model.
 */
function earlierAttempts(b: StepBuilder, refusalCategory: Map<string, string | null>): Step[] {
  const its = b.iterations;
  if (!its || its.length < 2) return [];
  const fellBack = its.some((it) => it?.type === 'fallback_message');
  const category = b.requestId ? (refusalCategory.get(b.requestId) ?? null) : null;
  return its.slice(0, -1).map((it, k) => {
    const usage = extractUsage(it);
    const model = String(it?.model ?? b.step.model);
    // A declined attempt bills if it produced output or its category is billed; other iterations always bill.
    const billed = !fellBack || usage.output > 0 || (category != null && BILLED_REFUSAL_CATEGORIES.has(category));
    return {
      ...b.step,
      id: `${b.step.id}#${k + 1}`,
      model,
      usage,
      tools: [],
      textPreview: '',
      hasThinking: false,
      stopReason: fellBack ? 'refusal' : String(it?.type ?? ''),
      cacheRebuild: false,
      rebuildReason: undefined,
      contextTokens: promptTokens(usage),
      cost: billed ? priceRequest(model, usage, { speed: b.step.speed, geo: b.geo }) : zeroCost(),
      refusal: fellBack ? { category, billed, fallbackModel: b.step.model } : undefined,
    };
  });
}

/**
 * Flags requests that rebuilt the prompt cache and estimates how long each tool result
 * kept costing money as cached context. `segmentStarts` are step indexes where a
 * compaction reset the context.
 */
function annotateThread(steps: Step[], segmentStarts: Set<number>) {
  let prev: Step | null = null;
  let segmentEnd = steps.length;
  const ends: number[] = new Array(steps.length);
  for (let i = steps.length - 1; i >= 0; i--) {
    ends[i] = segmentEnd;
    if (segmentStarts.has(i)) segmentEnd = i;
  }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const written = s.usage.cacheWrite5m + s.usage.cacheWrite1h;
    s.gapMinutes = prev && prev.ts && s.ts ? (Date.parse(s.ts) - Date.parse(prev.ts)) / 60000 : null;
    if (written >= REBUILD_MIN_TOKENS && written > 0.5 * s.contextTokens) {
      s.cacheRebuild = true;
      if (!prev) s.rebuildReason = 'first';
      else if (segmentStarts.has(i)) s.rebuildReason = 'compaction';
      else if (prev.model !== s.model) s.rebuildReason = 'model-switch';
      else {
        const ttl = prev.usage.cacheWrite1h > 0 ? 60 : 5;
        s.rebuildReason = s.gapMinutes != null && s.gapMinutes > ttl ? 'idle' : 'unknown';
      }
    }
    const resolved = resolvePrice(s.model);
    if (resolved) {
      const rates = ratesFor(resolved.price, s.usage, { speed: s.speed, geo: s.geo });
      const writeRate = s.usage.cacheWrite5m > s.usage.cacheWrite1h ? rates.write5m : rates.write1h;
      const remaining = Math.max(0, ends[i] - i - 2);
      for (const t of s.tools) {
        const tokens = t.resultChars / CHARS_PER_TOKEN;
        t.carryCost = (tokens * (writeRate + rates.read * remaining)) / 1e6;
      }
    }
    prev = s;
  }
}

/** Extra cost of an avoidable rebuild over reading the same tokens from cache. */
export function rebuildPremium(s: Step): number {
  const resolved = resolvePrice(s.model);
  if (!resolved || !isAvoidableRebuild(s)) return 0;
  const rates = ratesFor(resolved.price, s.usage, { speed: s.speed, geo: s.geo });
  return (s.usage.cacheWrite5m * (rates.write5m - rates.read) + s.usage.cacheWrite1h * (rates.write1h - rates.read)) / 1e6;
}

async function readMeta(file: string | null): Promise<Json> {
  if (!file) return {};
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * A subagent can be resumed by a later prompt, so its transcript is split into one run per
 * prompt; each part is charged to the prompt that was active when it ran.
 */
async function parseSubagent(file: string, metaFile: string | null, cwd: string): Promise<{ run: SubagentRun; promptId: string | null }[]> {
  const meta = await readMeta(metaFile);
  const thread = await readThread(file, cwd);
  annotateThread(
    thread.steps.map((b) => b.step),
    new Set(),
  );
  const agentId = path.basename(file, '.jsonl').replace(/^agent-/, '');
  const agentType = String(meta.agentType ?? meta.customAgentType ?? 'subagent');
  const description = String(meta.description ?? meta.name ?? '');
  const parts: { promptId: string | null; steps: Step[] }[] = [];
  for (const b of thread.steps) {
    const pid = b.promptId || null;
    let part = parts[parts.length - 1];
    if (!part || part.promptId !== pid) {
      part = { promptId: pid, steps: [] };
      parts.push(part);
    }
    part.steps.push(...b.attempts, b.step);
  }
  return parts.map((part, i) => ({
    promptId: part.promptId,
    run: buildRun(parts.length > 1 ? `${agentId}.${i + 1}` : agentId, agentType, i > 0 ? `${description} (resumed)`.trim() : description, part.steps),
  }));
}

function buildRun(agentId: string, agentType: string, description: string, steps: Step[]): SubagentRun {
  const usage = zeroUsage();
  const cost = zeroCost();
  const toolCounts: Record<string, number> = {};
  const models = new Set<string>();
  for (const s of steps) {
    addUsage(usage, s.usage);
    addCost(cost, s.cost);
    models.add(s.model);
    for (const t of s.tools) toolCounts[t.name] = (toolCounts[t.name] ?? 0) + 1;
  }
  return {
    agentId,
    agentType,
    description,
    models: [...models],
    start: steps[0]?.ts ?? '',
    end: steps[steps.length - 1]?.ts ?? '',
    usage,
    cost,
    steps,
    toolCounts,
  };
}

export async function parseSession(files: SessionFiles, opts: ParseOptions = {}): Promise<SessionDetail> {
  const prompts = new Map<string, PromptBuilder>();
  const compactions: { ts: string; trigger: string; preTokens: number; afterStepOrder: number }[] = [];
  const turnDurations = new Map<string, number>();
  const prLinks = new Set<string>();
  let promptOrder = 0;
  let stepsSeen = 0;
  let cwd = '';
  let gitBranch: string | null = null;
  let version: string | null = null;
  let aiTitle = '';
  let customTitle = '';
  let summaryTitle = '';
  let agentName = '';
  let reported: ReportedCost | null = null;
  let firstTs = '';
  let lastTs = '';
  let lastPromptId: string | null = null;
  const seenMessageIds = new Set<string>();

  const ensurePrompt =(id: string, ts: string, kind: PromptKind): Prompt => {
    let p = prompts.get(id);
    if (!p) {
      p = { prompt: newPrompt(id, ts, kind), order: promptOrder++ };
      prompts.set(id, p);
    }
    return p.prompt;
  };

  const main = await readThread(files.mainFile, '', (rec, promptIdFor) => {
    const ts: string = rec.timestamp ?? '';
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }
    if (!cwd && typeof rec.cwd === 'string') cwd = rec.cwd;
    if (typeof rec.gitBranch === 'string' && rec.gitBranch) gitBranch = rec.gitBranch;
    if (typeof rec.version === 'string') version = rec.version;

    switch (rec.type) {
      case 'ai-title':
        if (rec.aiTitle) aiTitle = String(rec.aiTitle);
        return;
      case 'custom-title':
        if (rec.customTitle) customTitle = String(rec.customTitle);
        return;
      case 'summary':
        if (rec.summary) summaryTitle = String(rec.summary);
        return;
      case 'agent-name':
        if (rec.agentName) agentName = String(rec.agentName);
        return;
      case 'pr-link':
        if (rec.prUrl) prLinks.add(String(rec.prUrl));
        return;
      case 'cost-state':
        // The counter covers requests made before this record was written; a resumed session appends later runs after it.
        reported = {
          totalUSD: num(rec.totalCostUSD),
          byModel: Object.fromEntries(Object.entries(rec.modelUsage ?? {}).map(([m, v]: [string, any]) => [m, num(v?.costUSD)])),
          startTime: rec.startTime ? new Date(rec.startTime).toISOString() : null,
          endTime: lastTs || null,
          linesAdded: num(rec.totalLinesAdded),
          linesRemoved: num(rec.totalLinesRemoved),
          windowEstimate: 0,
          comparable: true,
        };
        return;
      case 'system': {
        const pid = promptIdFor(rec);
        if (rec.subtype === 'turn_duration' && pid) {
          turnDurations.set(pid, (turnDurations.get(pid) ?? 0) + num(rec.durationMs));
        } else if (rec.subtype === 'compact_boundary') {
          compactions.push({
            ts,
            trigger: String(rec.compactMetadata?.trigger ?? 'manual'),
            preTokens: num(rec.compactMetadata?.preTokens),
            afterStepOrder: stepsSeen,
          });
        }
        return;
      }
      case 'assistant': {
        let pid = promptIdFor(rec);
        if (!pid) pid = promptIdFor({ ...rec, promptId: `continuation-${promptOrder}` })!;
        ensurePrompt(pid, ts, 'continuation');
        lastPromptId = pid;
        const msg = rec.message;
        if (msg?.usage && msg.model !== '<synthetic>' && !rec.isSidechain) {
          const id = msg.id ?? rec.requestId ?? rec.uuid;
          if (!seenMessageIds.has(id)) {
            seenMessageIds.add(id);
            stepsSeen++;
          }
        }
        return;
      }
      case 'user': {
        const content = rec.message?.content;
        const isToolResult = Array.isArray(content) && content.some((b: Json) => b?.type === 'tool_result');
        const { text, images } = userText(content);
        const trimmed = text.trim();
        const interrupt = /^\[Request interrupted by user/.test(trimmed);
        const injected = trimmed.startsWith('<local-command') || trimmed.startsWith('<bash-');
        const human = !isToolResult && !rec.isMeta && !rec.isCompactSummary && !rec.isSidechain && !interrupt && !injected && trimmed.length > 0;
        const teammate = /^(<teammate-message|Another Claude session sent a message)/.test(trimmed);

        // Transcripts from older Claude Code versions have no promptId: every human message starts a prompt.
        let pid: string | null = typeof rec.promptId === 'string' ? rec.promptId : null;
        if (!pid && human) pid = `prompt-${promptOrder}`;
        pid = pid ? promptIdFor({ ...rec, promptId: pid }) : promptIdFor(rec);
        if (!pid) return;
        lastPromptId = pid;
        const p = ensurePrompt(pid, ts, 'continuation');

        if (rec.isCompactSummary) {
          if (p.kind === 'continuation') {
            p.kind = 'compact-summary';
            p.text = 'Continued after context compaction';
          }
          return;
        }
        if (interrupt) {
          p.interrupted = true;
          return;
        }
        if (!human) return;
        p.imageCount += images;

        if (rec.origin?.kind === 'task-notification' || trimmed.startsWith('<task-notification')) {
          if (p.kind === 'continuation') {
            const summary = /<summary>([\s\S]*?)<\/summary>/.exec(trimmed)?.[1];
            p.kind = 'system';
            p.text = oneLine(`Background task notification${summary ? `: ${summary}` : ''}`, 300);
          }
          return;
        }
        if (teammate) {
          if (p.kind === 'continuation') {
            const from = /teammate_id="([^"]+)"/.exec(trimmed)?.[1];
            p.kind = 'system';
            p.text = `Message from another Claude session${from ? ` (${from})` : ''}`;
          }
          return;
        }
        const cmd = parseCommand(trimmed);
        if (cmd) {
          if (p.kind === 'continuation' || p.kind === 'system') {
            p.kind = 'command';
            p.command = cmd.command;
            p.text = truncate(`${cmd.command}${cmd.args ? ' ' + cmd.args : ''}`, MAX_PROMPT_CHARS);
          }
          return;
        }
        if (p.kind === 'continuation' || p.kind === 'system') {
          p.kind = 'prompt';
          p.text = truncate(trimmed, MAX_PROMPT_CHARS);
          p.ts = ts || p.ts;
        } else if (p.kind === 'prompt' && p.text.length < MAX_PROMPT_CHARS) {
          // Messages typed while Claude was working are queued into the same prompt.
          p.text = truncate(`${p.text}\n\n${trimmed}`, MAX_PROMPT_CHARS);
        }
        return;
      }
      default:
        if (rec.uuid) promptIdFor(rec);
    }
  });

  // Main-thread steps, in order, attached to their prompts.
  const mainBuilders = main.steps.filter((b) => !b.sidechain);
  const mainSteps = mainBuilders.map((b) => b.step);
  const segmentStarts = new Set<number>();
  for (const c of compactions) if (c.afterStepOrder < mainSteps.length) segmentStarts.add(c.afterStepOrder);
  annotateThread(mainSteps, segmentStarts);
  for (const b of mainBuilders) {
    const pid = b.promptId || lastPromptId || 'continuation-0';
    const p = ensurePrompt(pid, b.step.ts, 'continuation');
    p.steps.push(...b.attempts, b.step);
  }

  // Subagents attach to the prompt that spawned them.
  const ordered = () => [...prompts.values()].sort((a, b) => a.order - b.order).map((p) => p.prompt);
  const runs: { run: SubagentRun; promptId: string | null }[] = [];
  const legacy = new Map<string, Step[]>();
  for (const b of main.steps) {
    if (!b.sidechain) continue;
    const key = b.promptId || lastPromptId || 'continuation-0';
    legacy.set(key, [...(legacy.get(key) ?? []), ...b.attempts, b.step]);
  }
  for (const [promptId, steps] of legacy) {
    annotateThread(steps, new Set());
    runs.push({ promptId, run: buildRun(`sidechain-${promptId}`, 'sidechain', 'Subagent (inline transcript)', steps) });
  }
  for (const sf of files.subagentFiles) runs.push(...(await parseSubagent(sf.file, sf.metaFile, cwd)));

  for (const { run, promptId } of runs) {
    if (run.steps.length === 0) continue;
    let target = promptId ? prompts.get(promptId)?.prompt : undefined;
    if (!target) {
      const list = ordered();
      target = [...list].reverse().find((p) => p.ts && run.start && p.ts <= run.start) ?? list[list.length - 1];
    }
    if (!target) target = ensurePrompt(`continuation-${promptOrder}`, run.start, 'continuation');
    target.subagents.push(run);
  }

  // Finalize prompts.
  const list = ordered().filter((p) => p.steps.length > 0 || p.subagents.length > 0);
  const usage = zeroUsage();
  const cost = zeroCost();
  const costByModel: Record<string, number> = {};
  const models = new Set<string>();
  const toolStats = new Map<string, ToolStat>();
  let subagentCost = 0;
  const subagentIds = new Set<string>();
  let cacheRebuilds = 0;
  let cacheRebuildCost = 0;
  let peakContext = 0;
  let activeMs = 0;
  let stepCount = 0;

  const addTools = (tools: ToolCall[]) => {
    for (const t of tools) {
      const s = toolStats.get(t.name) ?? { name: t.name, calls: 0, errors: 0, resultChars: 0, carryCost: 0 };
      s.calls++;
      if (t.isError) s.errors++;
      s.resultChars += t.resultChars;
      s.carryCost += t.carryCost;
      toolStats.set(t.name, s);
    }
  };

  list.forEach((p, i) => {
    p.index = i + 1;
    p.steps.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    if (!p.ts) p.ts = p.steps[0]?.ts ?? p.subagents[0]?.start ?? '';
    if (p.kind === 'continuation' && !p.text) p.text = '(continued without a new prompt)';
    for (const s of p.steps) {
      addUsage(p.usage, s.usage);
      addCost(p.cost, s.cost);
      p.ownCost += s.cost.total;
      costByModel[s.model] = (costByModel[s.model] ?? 0) + s.cost.total;
      models.add(s.model);
      p.peakContext = Math.max(p.peakContext, s.contextTokens);
      for (const t of s.tools) p.toolCounts[t.name] = (p.toolCounts[t.name] ?? 0) + 1;
      addTools(s.tools);
      if (isAvoidableRebuild(s)) {
        cacheRebuilds++;
        cacheRebuildCost += rebuildPremium(s);
      }
    }
    stepCount += p.steps.length;
    for (const run of p.subagents) {
      addUsage(p.usage, run.usage);
      addCost(p.cost, run.cost);
      subagentCost += run.cost.total;
      subagentIds.add(run.agentId.split('.')[0]);
      stepCount += run.steps.length;
      for (const s of run.steps) {
        costByModel[s.model] = (costByModel[s.model] ?? 0) + s.cost.total;
        models.add(s.model);
        addTools(s.tools);
        if (isAvoidableRebuild(s)) {
          cacheRebuilds++;
          cacheRebuildCost += rebuildPremium(s);
        }
      }
    }
    const recorded = turnDurations.get(p.id);
    if (recorded) {
      p.durationMs = recorded;
    } else if (p.steps.length && p.ts) {
      const last = p.steps[p.steps.length - 1].ts;
      const d = Date.parse(last) - Date.parse(p.ts);
      p.durationMs = Number.isFinite(d) && d >= 0 ? d : null;
    }
    activeMs += p.durationMs ?? 0;
    addUsage(usage, p.usage);
    addCost(cost, p.cost);
    peakContext = Math.max(peakContext, p.peakContext);
  });

  const compactionEvents: CompactionEvent[] = compactions.map((c) => {
    const promptIndex = list.find((p) => p.steps.some((s) => s === mainSteps[c.afterStepOrder]))?.index ?? list.length;
    return { ts: c.ts, trigger: c.trigger, preTokens: c.preTokens, afterPromptIndex: promptIndex };
  });

  const firstReal = list.find((p) => p.kind === 'prompt' || p.kind === 'command');
  const firstPrompt = firstReal ? oneLine(firstReal.text, 300) : '';
  const allSteps = list.flatMap((p) => [...p.steps, ...p.subagents.flatMap((r) => r.steps)]);
  const start = allSteps.reduce((m, s) => (s.ts && (!m || s.ts < m) ? s.ts : m), '') || firstTs;
  const end = allSteps.reduce((m, s) => (s.ts && s.ts > m ? s.ts : m), '') || lastTs;
  const now = opts.now ?? Date.now();
  const rep = reported as ReportedCost | null;
  if (rep) {
    const since = rep.startTime ? Date.parse(rep.startTime) : 0;
    const until = rep.endTime ? Date.parse(rep.endTime) : Infinity;
    rep.windowEstimate = allSteps.reduce((a, s) => {
      const t = Date.parse(s.ts);
      return t >= since && t <= until ? a + s.cost.total : a;
    }, 0);
    rep.comparable = rep.windowEstimate <= rep.totalUSD;
  }

  return {
    id: files.id,
    projectId: files.projectId,
    cwd,
    title: oneLine(customTitle || agentName || aiTitle || summaryTitle || firstPrompt || 'Untitled session', 140),
    firstPrompt,
    start,
    end,
    activeMs,
    promptCount: list.filter((p) => p.kind === 'prompt' || p.kind === 'command').length,
    stepCount,
    usage,
    cost,
    costByModel,
    models: [...models],
    gitBranch,
    version,
    subagentCount: subagentIds.size,
    subagentCost,
    compactions: compactions.length,
    cacheRebuilds,
    cacheRebuildCost,
    peakContext,
    reported,
    prLinks: [...prLinks],
    isLive: opts.mtimeMs != null && now - opts.mtimeMs < (opts.liveWindowMs ?? 3 * 60_000),
    fileBytes: opts.fileBytes ?? 0,
    prompts: list,
    compactionEvents,
    insights: [],
    toolStats: [...toolStats.values()].sort((a, b) => b.carryCost - a.carryCost),
  };
}
