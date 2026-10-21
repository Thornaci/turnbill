import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiMiddleware, isLocalHost } from './api';
import { Store } from './store';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export interface ServeOptions {
  port: number;
  root?: string;
  staticDir: string;
}

export async function serve(opts: ServeOptions) {
  const store = new Store(opts.root);
  await store.refresh(true);
  const api = apiMiddleware(store);

  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/api/')) return api(req, res);
    if (!isLocalHost(req.headers.host)) {
      res.statusCode = 403;
      return res.end('Forbidden');
    }
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let file = path.join(opts.staticDir, pathname);
    if (!file.startsWith(opts.staticDir)) {
      res.statusCode = 400;
      return res.end();
    }
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = path.join(file, 'index.html');
    } catch {
      // Client-side routes fall back to the app shell.
      file = path.join(opts.staticDir, 'index.html');
    }
    const ext = path.extname(file);
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    if (pathname.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    createReadStream(file)
      .on('error', () => {
        res.statusCode = 404;
        res.end('Not found');
      })
      .pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', resolve);
  });
  return { server, store, url: `http://localhost:${opts.port}` };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const port = Number(process.env.PORT) || 4317;
  serve({ port, staticDir: path.resolve(here, '../dist') }).then(({ url }) => console.log(`Tokenscope running at ${url}`));
}
