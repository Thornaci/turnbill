import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serves the transcript API from the Vite dev server so `npm run dev` is a single process.
 * The server code is loaded through Vite's SSR loader, which keeps this config free of
 * TypeScript imports and picks up server edits on the next request.
 */
function turnbillApi(): Plugin {
  return {
    name: 'turnbill-api',
    configureServer(server) {
      let store: object | undefined;
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api/')) return next();
        const { Store } = await server.ssrLoadModule('/server/store.ts');
        const { apiMiddleware } = await server.ssrLoadModule('/server/api.ts');
        // A server edit reloads the module; rebuild the store so it runs the new code.
        if (!(store instanceof Store)) store = new Store(process.env.TURNBILL_DIR);
        return apiMiddleware(store)(req, res, next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), turnbillApi()],
  server: { host: '127.0.0.1', port: 5173 },
  // Served from localhost; one larger chart chunk is fine.
  build: { chunkSizeWarningLimit: 900 },
});
