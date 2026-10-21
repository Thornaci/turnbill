import { describe, expect, it } from 'vitest';
import { normalizeModelId, priceRequest, priceUncached, resolvePrice, zeroUsage } from '../shared/pricing';
import type { Usage } from '../shared/types';

const usage = (u: Partial<Usage>): Usage => ({ ...zeroUsage(), ...u });
const M = 1_000_000;

describe('normalizeModelId', () => {
  it.each([
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    ['claude-opus-5[1m]', 'claude-opus-5'],
    ['us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'claude-sonnet-4-5'],
    ['anthropic.claude-opus-5-5', 'claude-opus-5-5'],
    ['claude-opus-4-5@20251101', 'claude-opus-4-5'],
    ['claude-3-5-sonnet-20241022', 'claude-3-5-sonnet'],
  ])('%s → %s', (raw, id) => expect(normalizeModelId(raw)).toBe(id));
});

describe('priceRequest', () => {
  it('prices each token category at Opus 5.5 rates', () => {
    const c = priceRequest('claude-opus-5-5', usage({ input: M, cacheRead: M, cacheWrite5m: M, cacheWrite1h: M, output: M }));
    expect(c.input).toBeCloseTo(4);
    expect(c.cacheRead).toBeCloseTo(0.2);
    expect(c.cacheWrite).toBeCloseTo(5 + 8);
    expect(c.output).toBeCloseTo(20);
    expect(c.total).toBeCloseTo(37.2);
  });

  it('uses the per-model cache-read multiplier', () => {
    expect(priceRequest('claude-fable-5-1', usage({ cacheRead: M })).total).toBeCloseTo(0.25);
    expect(priceRequest('claude-fable-5', usage({ cacheRead: M })).total).toBeCloseTo(1);
    expect(priceRequest('claude-sonnet-5-5', usage({ cacheRead: M })).total).toBeCloseTo(0.1);
    expect(priceRequest('claude-sonnet-5', usage({ cacheRead: M })).total).toBeCloseTo(0.2);
  });

  it('applies fast-mode rates with cache multipliers on top', () => {
    const c = priceRequest('claude-opus-5-5', usage({ input: M, cacheWrite1h: M, cacheRead: M, output: M }), { speed: 'fast' });
    expect(c.input).toBeCloseTo(8);
    expect(c.cacheWrite).toBeCloseTo(16);
    expect(c.cacheRead).toBeCloseTo(0.4);
    expect(c.output).toBeCloseTo(40);
  });

  it('ignores fast mode on models without fast pricing', () => {
    expect(priceRequest('claude-sonnet-5', usage({ input: M }), { speed: 'fast' }).total).toBeCloseTo(2);
  });

  it('prices Haiku 5.5 by prompt length, counting cache reads and writes', () => {
    expect(priceRequest('claude-haiku-5-5', usage({ input: 50_000, output: M })).output).toBeCloseTo(0.5);
    const long = priceRequest('claude-haiku-5-5', usage({ input: 10_000, cacheRead: 95_000, output: M }));
    expect(long.output).toBeCloseTo(2.5);
    expect(long.cacheRead).toBeCloseTo((95_000 * 0.05) / M);
  });

  it('applies the US data-residency multiplier only to 4.6+ models', () => {
    expect(priceRequest('claude-opus-5-5', usage({ input: M }), { geo: 'us' }).total).toBeCloseTo(4.4);
    expect(priceRequest('claude-opus-4-5', usage({ input: M }), { geo: 'us' }).total).toBeCloseTo(5);
  });

  it('charges web searches at $10 per thousand', () => {
    expect(priceRequest('claude-opus-5-5', usage({ webSearches: 3 })).total).toBeCloseTo(0.03);
  });

  it('falls back to the family default for unknown ids and flags it', () => {
    const r = resolvePrice('claude-opus-9-9');
    expect(r?.approximate).toBe(true);
    expect(r?.price.id).toBe('claude-opus-5-5');
    expect(resolvePrice('gpt-4o')).toBeNull();
    expect(priceRequest('gpt-4o', usage({ input: M })).total).toBe(0);
  });

  it('computes the no-cache baseline at the base input rate', () => {
    expect(priceUncached('claude-opus-5-5', usage({ cacheRead: M, cacheWrite1h: M, output: 0 }))).toBeCloseTo(8);
  });
});
