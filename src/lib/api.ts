import { useCallback, useEffect, useRef, useState } from 'react';

const cache = new Map<string, unknown>();

export interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  /** True while a request is in flight; previous data stays visible. */
  loading: boolean;
  reload: () => void;
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Not JSON.
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetches JSON with stale-while-revalidate: cached data renders immediately and the
 * previous render stays on screen during refetches instead of flashing a skeleton.
 */
export function useApi<T>(path: string | null, opts: { poll?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T | undefined>(() => (path ? (cache.get(path) as T | undefined) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const pathRef = useRef(path);

  useEffect(() => {
    pathRef.current = path;
    if (!path) return;
    const cached = cache.get(path) as T | undefined;
    if (cached !== undefined) setData(cached);
    const ctrl = new AbortController();
    setLoading(true);
    getJson<T>(path, ctrl.signal)
      .then((d) => {
        cache.set(path, d);
        if (pathRef.current === path) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError' && pathRef.current === path) setError(e.message);
      })
      .finally(() => {
        if (pathRef.current === path) setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, tick]);

  useEffect(() => {
    if (!opts.poll) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    }, opts.poll);
    return () => clearInterval(id);
  }, [opts.poll]);

  useEffect(() => {
    const onFocus = () => setTick((t) => t + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
