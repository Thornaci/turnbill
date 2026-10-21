#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);

function flag(name) {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = args[i];
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
}

if (flag('help') || flag('h')) {
  console.log(`Tokenscope — local cost explorer for Claude Code

Usage: tokenscope [--port 4317] [--dir ~/.claude/projects] [--open]

  --port   Port to listen on (default 4317, or $PORT)
  --dir    Claude Code projects directory (default $CLAUDE_CONFIG_DIR/projects or ~/.claude/projects)
  --open   Open the dashboard in your browser

The server listens on 127.0.0.1 only. Transcripts never leave this machine.`);
  process.exit(0);
}

const serverEntry = path.join(root, 'dist-server', 'index.js');
const staticDir = path.join(root, 'dist');
if (!existsSync(serverEntry) || !existsSync(path.join(staticDir, 'index.html'))) {
  console.error('Tokenscope is not built yet. Run `npm run build` first (or `npm run dev` for development).');
  process.exit(1);
}

const port = Number(flag('port')) || Number(process.env.PORT) || 4317;
const dir = typeof flag('dir') === 'string' ? path.resolve(String(flag('dir')).replace(/^~(?=\/|$)/, process.env.HOME ?? '~')) : undefined;

const { serve } = await import(pathToFileURL(serverEntry).href);
try {
  const started = Date.now();
  const { url, store } = await serve({ port, root: dir, staticDir });
  const status = store.dataStatus();
  console.log(`Tokenscope  ${url}`);
  console.log(`Reading     ${status.root} (${status.files} files, parsed in ${Date.now() - started} ms)`);
  for (const w of status.warnings) console.log(`            ${w}`);
  if (flag('open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const openArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(opener, openArgs, { stdio: 'ignore', detached: true }).unref();
  }
} catch (err) {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Try --port ${port + 1}.`);
    process.exit(1);
  }
  throw err;
}
