// Shared between the Node API and the React client.

export interface Usage {
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
  webSearches: number;
}

export interface Cost {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  webSearch: number;
  total: number;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Short human-readable description of the call: file path, command, pattern… */
  summary: string;
  /** Characters returned by the tool result (what got appended to the context). */
  resultChars: number;
  isError: boolean;
  /** Estimated cost of carrying this result in context for the rest of its context segment. */
  carryCost: number;
}

export interface Step {
  id: string;
  ts: string;
  model: string;
  speed: 'standard' | 'fast';
  usage: Usage;
  cost: Cost;
  /** input + cache read + cache write: the prompt size of this request. */
  contextTokens: number;
  tools: ToolCall[];
  textPreview: string;
  hasThinking: boolean;
  stopReason: string | null;
  /** True when this request wrote most of its prompt to cache instead of reading it. */
  cacheRebuild: boolean;
  /** Why the cache was rebuilt, when it could be inferred. */
  rebuildReason?: 'idle' | 'model-switch' | 'compaction' | 'first' | 'unknown';
  /** Minutes since the previous request in the same thread. */
  gapMinutes: number | null;
}

export interface SubagentRun {
  agentId: string;
  agentType: string;
  description: string;
  models: string[];
  start: string;
  end: string;
  usage: Usage;
  cost: Cost;
  steps: Step[];
  toolCounts: Record<string, number>;
}

export type PromptKind = 'prompt' | 'command' | 'compact-summary' | 'continuation' | 'system';

export interface Prompt {
  id: string;
  index: number;
  ts: string;
  kind: PromptKind;
  text: string;
  /** Present when the prompt came from a slash command. */
  command?: string;
  imageCount: number;
  steps: Step[];
  subagents: SubagentRun[];
  usage: Usage;
  cost: Cost;
  /** Cost of main-thread steps only (excludes subagents). */
  ownCost: number;
  durationMs: number | null;
  interrupted: boolean;
  toolCounts: Record<string, number>;
  peakContext: number;
}

export interface CompactionEvent {
  ts: string;
  trigger: string;
  preTokens: number;
  afterPromptIndex: number;
}

/**
 * Claude Code's own running cost counter (`cost-state`), which covers only its last process run
 * and includes background requests that are never written to the transcript.
 */
export interface ReportedCost {
  totalUSD: number;
  byModel: Record<string, number>;
  startTime: string | null;
  linesAdded: number;
  linesRemoved: number;
  /** Tokenscope's estimate for requests made since `startTime`, for a like-for-like comparison. */
  windowEstimate: number;
}

export interface SessionSummary {
  id: string;
  projectId: string;
  cwd: string;
  title: string;
  firstPrompt: string;
  start: string;
  end: string;
  /** Sum of prompt turn durations when recorded, otherwise wall-clock between first and last request. */
  activeMs: number;
  promptCount: number;
  stepCount: number;
  usage: Usage;
  cost: Cost;
  costByModel: Record<string, number>;
  models: string[];
  gitBranch: string | null;
  version: string | null;
  subagentCount: number;
  subagentCost: number;
  compactions: number;
  cacheRebuilds: number;
  cacheRebuildCost: number;
  peakContext: number;
  reported: ReportedCost | null;
  prLinks: string[];
  isLive: boolean;
  fileBytes: number;
}

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Insight {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Dollar amount this insight is about (waste, potential saving, spend share). */
  impactUSD?: number;
  sessionId?: string;
  projectId?: string;
  promptIndex?: number;
}

export interface SessionDetail extends SessionSummary {
  prompts: Prompt[];
  compactionEvents: CompactionEvent[];
  insights: Insight[];
  toolStats: ToolStat[];
}

export interface ToolStat {
  name: string;
  calls: number;
  errors: number;
  resultChars: number;
  carryCost: number;
}

export interface ProjectSummary {
  id: string;
  path: string;
  name: string;
  sessionCount: number;
  promptCount: number;
  stepCount: number;
  usage: Usage;
  cost: Cost;
  firstActive: string;
  lastActive: string;
  topModel: string | null;
  isLive: boolean;
}

export interface DailyPoint {
  date: string;
  total: number;
  byModel: Record<string, number>;
  steps: number;
}

export interface Overview {
  range: { from: string | null; to: string | null };
  totals: {
    cost: Cost;
    usage: Usage;
    sessions: number;
    projects: number;
    prompts: number;
    steps: number;
    /** What the same requests would have cost with no prompt caching at all. */
    uncachedCost: number;
    subagentCost: number;
    cacheRebuildCost: number;
  };
  /** Spend by calendar month, independent of the range filter (used for plan comparison). */
  monthly: { month: string; total: number }[];
  daily: DailyPoint[];
  /** [dayOfWeek 0=Mon][hour] → cost */
  heatmap: number[][];
  costByModel: Record<string, number>;
  usageByModel: Record<string, Usage>;
  topSessions: SessionSummary[];
  /** Sessions whose transcript changed in the last few minutes. */
  live: SessionSummary[];
  topPrompts: { sessionId: string; projectId: string; sessionTitle: string; index: number; text: string; cost: number; steps: number; ts: string }[];
  toolStats: ToolStat[];
  projects: ProjectSummary[];
  insights: Insight[];
  dataStatus: DataStatus;
}

export interface DataStatus {
  root: string;
  files: number;
  bytes: number;
  parsedAt: string;
  parseMs: number;
  warnings: string[];
  /** Sessions where Claude Code's own counter overlaps transcript requests. */
  calibration: { sessions: number; reportedUSD: number; estimatedUSD: number };
  /** Every model seen in any transcript, in pricing-table order; drives stable chart colors. */
  models: string[];
}

export interface SearchHit {
  sessionId: string;
  projectId: string;
  sessionTitle: string;
  projectPath: string;
  promptIndex: number;
  kind: 'prompt' | 'tool' | 'title';
  snippet: string;
  ts: string;
  cost: number;
}
