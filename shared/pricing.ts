import type { Cost, Usage } from './types';

/** USD per million tokens. */
export interface Rates {
  input: number;
  write5m: number;
  write1h: number;
  read: number;
  output: number;
}

export interface ModelPrice {
  id: string;
  label: string;
  family: 'fable' | 'mythos' | 'opus' | 'sonnet' | 'haiku';
  rates: Rates;
  /** Rates for requests whose prompt exceeds `longContext.threshold` tokens. */
  longContext?: { threshold: number; rates: Rates };
  /** Fast-mode (`speed: "fast"`) rates. Cache multipliers already applied. */
  fast?: Rates;
  /** Data residency (`inference_geo: "us"`) multiplier applies to 4.6+ models. */
  geoMultiplier: boolean;
  /** Not on the current pricing page; historical list price. */
  historical?: boolean;
  /** Model is selectable as a what-if target. */
  whatIf?: boolean;
}

export const PRICING_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
export const PRICING_AS_OF = '2026-10-21';
export const WEB_SEARCH_USD = 10 / 1000;

/** Builds a rate card from base input/output and the cache-read multiplier. */
function card(input: number, output: number, readMultiplier = 0.1): Rates {
  return {
    input,
    write5m: input * 1.25,
    write1h: input * 2,
    read: round6(input * readMultiplier),
    output,
  };
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

export const MODEL_PRICES: ModelPrice[] = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1', family: 'fable', rates: card(10, 50, 0.025), geoMultiplier: true, whatIf: true },
  { id: 'claude-mythos-5-1', label: 'Mythos 5.1', family: 'mythos', rates: card(10, 50, 0.025), geoMultiplier: true },
  { id: 'claude-fable-5', label: 'Fable 5', family: 'fable', rates: card(10, 50, 0.1), geoMultiplier: true },
  { id: 'claude-mythos-5', label: 'Mythos 5', family: 'mythos', rates: card(10, 50, 0.1), geoMultiplier: true },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', family: 'opus', rates: card(4, 20, 0.05), fast: card(8, 40, 0.05), geoMultiplier: true, whatIf: true },
  { id: 'claude-opus-5', label: 'Opus 5', family: 'opus', rates: card(5, 25), fast: card(10, 50), geoMultiplier: true },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', family: 'opus', rates: card(5, 25), fast: card(10, 50), geoMultiplier: true },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', family: 'opus', rates: card(5, 25), geoMultiplier: true },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', family: 'opus', rates: card(5, 25), geoMultiplier: true },
  { id: 'claude-opus-4-5', label: 'Opus 4.5', family: 'opus', rates: card(5, 25), geoMultiplier: false },
  { id: 'claude-opus-4-1', label: 'Opus 4.1', family: 'opus', rates: card(15, 75), geoMultiplier: false },
  { id: 'claude-opus-4', label: 'Opus 4', family: 'opus', rates: card(15, 75), geoMultiplier: false },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', family: 'sonnet', rates: card(2, 10, 0.05), geoMultiplier: true, whatIf: true },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', family: 'sonnet', rates: card(2, 10), geoMultiplier: true },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', family: 'sonnet', rates: card(3, 15), geoMultiplier: true },
  // Sonnet 4 / 4.5 billed prompts over 200K tokens (1M-context beta) at the long-context rate.
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', family: 'sonnet', rates: card(3, 15), geoMultiplier: false, longContext: { threshold: 200_000, rates: card(6, 22.5) } },
  { id: 'claude-sonnet-4', label: 'Sonnet 4', family: 'sonnet', rates: card(3, 15), geoMultiplier: false, longContext: { threshold: 200_000, rates: card(6, 22.5) } },
  {
    id: 'claude-haiku-5-5', label: 'Haiku 5.5', family: 'haiku', rates: card(0.1, 0.5), geoMultiplier: true, whatIf: true,
    longContext: { threshold: 100_000, rates: card(0.5, 2.5) },
  },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', family: 'haiku', rates: card(1, 5), geoMultiplier: false },
  { id: 'claude-3-5-haiku', label: 'Haiku 3.5', family: 'haiku', rates: card(0.8, 4), geoMultiplier: false },
  { id: 'claude-3-7-sonnet', label: 'Sonnet 3.7', family: 'sonnet', rates: card(3, 15), geoMultiplier: false, historical: true },
  { id: 'claude-3-5-sonnet', label: 'Sonnet 3.5', family: 'sonnet', rates: card(3, 15), geoMultiplier: false, historical: true },
  { id: 'claude-3-opus', label: 'Opus 3', family: 'opus', rates: card(15, 75), geoMultiplier: false, historical: true },
  { id: 'claude-3-haiku', label: 'Haiku 3', family: 'haiku', rates: { input: 0.25, write5m: 0.3, write1h: 0.5, read: 0.03, output: 1.25 }, geoMultiplier: false, historical: true },
];

const BY_ID = new Map(MODEL_PRICES.map((m) => [m.id, m]));
const FAMILY_FALLBACK: Record<string, string> = {
  fable: 'claude-fable-5-1',
  mythos: 'claude-mythos-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

/**
 * Normalizes ids as they appear in transcripts and on cloud providers:
 * `claude-haiku-4-5-20251001`, `claude-opus-5[1m]`, `us.anthropic.claude-sonnet-4-5-20250929-v1:0`,
 * `claude-opus-4-5@20251101`.
 */
export function normalizeModelId(raw: string): string {
  let id = raw.toLowerCase().trim();
  id = id.replace(/\[[^\]]*\]$/, '');
  id = id.replace(/^(?:[a-z]{2,4}\.)?anthropic\./, '');
  id = id.replace(/-v\d+(?::\d+)?$/, '');
  id = id.replace(/@.*$/, '');
  id = id.replace(/-\d{8}$/, '');
  return id;
}

export interface ResolvedPrice {
  price: ModelPrice;
  /** True when the model id was not in the table and a family default was used. */
  approximate: boolean;
}

const resolveCache = new Map<string, ResolvedPrice | null>();

export function resolvePrice(model: string): ResolvedPrice | null {
  const cached = resolveCache.get(model);
  if (cached !== undefined) return cached;
  const id = normalizeModelId(model);
  let result: ResolvedPrice | null = null;
  const exact = BY_ID.get(id);
  if (exact) {
    result = { price: exact, approximate: false };
  } else {
    const family = Object.keys(FAMILY_FALLBACK).find((f) => id.includes(f));
    if (family) result = { price: BY_ID.get(FAMILY_FALLBACK[family])!, approximate: true };
  }
  resolveCache.set(model, result);
  return result;
}

export function modelLabel(model: string): string {
  const r = resolvePrice(model);
  if (!r) return model;
  return r.approximate ? `${model}` : r.price.label;
}

export function promptTokens(u: Usage): number {
  return u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
}

export interface PriceOptions {
  speed?: 'standard' | 'fast';
  geo?: string | null;
}

export function ratesFor(price: ModelPrice, u: Usage, opts: PriceOptions = {}): Rates {
  let rates = price.rates;
  if (price.longContext && promptTokens(u) > price.longContext.threshold) rates = price.longContext.rates;
  // Fast mode pricing applies across the full context window and replaces long-context rates.
  if (opts.speed === 'fast' && price.fast) rates = price.fast;
  if (opts.geo === 'us' && price.geoMultiplier) {
    rates = {
      input: rates.input * 1.1,
      write5m: rates.write5m * 1.1,
      write1h: rates.write1h * 1.1,
      read: rates.read * 1.1,
      output: rates.output * 1.1,
    };
  }
  return rates;
}

export function zeroCost(): Cost {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, webSearch: 0, total: 0 };
}

export function zeroUsage(): Usage {
  return { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, webSearches: 0 };
}

export function costOf(u: Usage, rates: Rates): Cost {
  const input = (u.input * rates.input) / 1e6;
  const cacheRead = (u.cacheRead * rates.read) / 1e6;
  const cacheWrite = (u.cacheWrite5m * rates.write5m + u.cacheWrite1h * rates.write1h) / 1e6;
  const output = (u.output * rates.output) / 1e6;
  const webSearch = u.webSearches * WEB_SEARCH_USD;
  return { input, cacheRead, cacheWrite, output, webSearch, total: input + cacheRead + cacheWrite + output + webSearch };
}

/** Prices one API request. Unknown models (not even a family match) cost 0. */
export function priceRequest(model: string, u: Usage, opts: PriceOptions = {}): Cost {
  const r = resolvePrice(model);
  if (!r) return zeroCost();
  return costOf(u, ratesFor(r.price, u, opts));
}

/** Prices the same request as if prompt caching had been off: every prompt token at the base input rate. */
export function priceUncached(model: string, u: Usage, opts: PriceOptions = {}): number {
  const r = resolvePrice(model);
  if (!r) return 0;
  const rates = ratesFor(r.price, u, opts);
  return (promptTokens(u) * rates.input + u.output * rates.output) / 1e6 + u.webSearches * WEB_SEARCH_USD;
}

export function addUsage(a: Usage, b: Usage): Usage {
  a.input += b.input;
  a.cacheRead += b.cacheRead;
  a.cacheWrite5m += b.cacheWrite5m;
  a.cacheWrite1h += b.cacheWrite1h;
  a.output += b.output;
  a.webSearches += b.webSearches;
  return a;
}

export function addCost(a: Cost, b: Cost): Cost {
  a.input += b.input;
  a.cacheRead += b.cacheRead;
  a.cacheWrite += b.cacheWrite;
  a.output += b.output;
  a.webSearch += b.webSearch;
  a.total += b.total;
  return a;
}

export function whatIfModels(): ModelPrice[] {
  return MODEL_PRICES.filter((m) => m.whatIf);
}
