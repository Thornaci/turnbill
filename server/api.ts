import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Range, Store } from './store';

function parseRange(params: URLSearchParams): Range {
  const read = (key: string) => {
    const v = params.get(key);
    if (!v) return null;
    const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    return Number.isFinite(n) ? n : null;
  };
  return { from: read('from'), to: read('to') };
}

/**
 * Only answer requests addressed to this machine by name. Without this, a web page could use
 * DNS rebinding to read local transcripts through the dashboard.
 */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

export async function routeApi(store: Store, url: URL): Promise<{ status: number; body: unknown }> {
  await store.refresh();
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const range = parseRange(url.searchParams);

  switch (parts[0]) {
    case 'status':
      return { status: 200, body: store.dataStatus() };
    case 'overview':
      return { status: 200, body: store.overview(range) };
    case 'projects': {
      if (!parts[1]) return { status: 200, body: store.projects(range) };
      const project = store.project(parts[1], range);
      return project ? { status: 200, body: project } : { status: 404, body: { error: 'Project not found in this range' } };
    }
    case 'sessions': {
      if (!parts[1]) return { status: 200, body: store.sessions(range, url.searchParams.get('project') ?? undefined) };
      const session = store.getSession(parts[1]);
      return session ? { status: 200, body: { ...session, projectPath: store.projectPath(session.projectId) } } : { status: 404, body: { error: 'Session not found' } };
    }
    case 'search':
      return { status: 200, body: store.search(url.searchParams.get('q') ?? '') };
    case 'refresh':
      await store.refresh(true);
      return { status: 200, body: store.dataStatus() };
    default:
      return { status: 404, body: { error: 'Unknown endpoint' } };
  }
}

export function apiMiddleware(store: Store) {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (!req.url?.startsWith('/api/')) return next?.();
    if (!isLocalHost(req.headers.host)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    try {
      const { status, body } = await routeApi(store, new URL(req.url, 'http://localhost'));
      const json = JSON.stringify(body);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(json);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  };
}
