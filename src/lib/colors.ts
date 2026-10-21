import { modelLabel } from '../../shared/pricing';
import type { Cost } from '../../shared/types';

/** Token categories in stacking order; adjacent pairs follow the validated slot order. */
export const CATEGORIES = [
  { key: 'cacheRead', label: 'Cache read', color: 'var(--c1)', hint: 'Re-reading context already in the prompt cache' },
  { key: 'cacheWrite', label: 'Cache write', color: 'var(--c2)', hint: 'Writing new context to the prompt cache' },
  { key: 'output', label: 'Output', color: 'var(--c3)', hint: 'Generated tokens, including thinking' },
  { key: 'input', label: 'Input', color: 'var(--c4)', hint: 'Uncached input tokens' },
] as const satisfies readonly { key: keyof Cost; label: string; color: string; hint: string }[];

export type CategoryKey = (typeof CATEGORIES)[number]['key'];

const SLOTS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];

/**
 * Colors follow the model, not its rank: the order comes from every model seen in the
 * data, so filtering a range never repaints the survivors.
 */
export function modelColor(model: string, allModels: string[]): string {
  const i = allModels.indexOf(model);
  return i >= 0 && i < SLOTS.length ? SLOTS[i] : 'var(--c-other)';
}

export { modelLabel };
