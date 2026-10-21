import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export const RANGES = [
  { key: '24h', label: '24h', title: 'Last 24 hours' },
  { key: '7d', label: '7d', title: 'Last 7 days' },
  { key: '30d', label: '30d', title: 'Last 30 days' },
  { key: 'month', label: 'MTD', title: 'This month' },
  { key: '90d', label: '90d', title: 'Last 90 days' },
  { key: 'all', label: 'All', title: 'All time' },
] as const;

export type RangeKey = (typeof RANGES)[number]['key'];

const STORAGE_KEY = 'tokenscope.range';
const DAY = 86_400_000;
/** Round "now" so the query string — and the fetch cache key — stays stable for a few minutes. */
const BUCKET = 5 * 60_000;

function readStored(): RangeKey | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return RANGES.some((r) => r.key === v) ? (v as RangeKey) : null;
  } catch {
    return null;
  }
}

export function rangeFrom(key: RangeKey, now = Date.now()): number | null {
  const t = Math.floor(now / BUCKET) * BUCKET;
  switch (key) {
    case '24h':
      return t - DAY;
    case '7d':
      return t - 7 * DAY;
    case '30d':
      return t - 30 * DAY;
    case '90d':
      return t - 90 * DAY;
    case 'month': {
      const d = new Date(now);
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    }
    default:
      return null;
  }
}

export function useRange() {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('range');
  const key: RangeKey = RANGES.some((r) => r.key === fromUrl) ? (fromUrl as RangeKey) : (readStored() ?? 'all');
  const from = rangeFrom(key);
  const query = from == null ? '' : `from=${from}`;
  const meta = RANGES.find((r) => r.key === key)!;

  const setKey = useCallback(
    (next: RangeKey) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage unavailable; the URL still carries the range.
      }
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (next === 'all') n.delete('range');
          else n.set('range', next);
          return n;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return useMemo(() => ({ key, from, query, label: meta.title, setKey }), [key, from, query, meta.title, setKey]);
}

/** Appends the current range to an in-app link so drill-downs keep the filter. */
export function withRange(path: string, key: RangeKey): string {
  return key === 'all' ? path : `${path}?range=${key}`;
}
