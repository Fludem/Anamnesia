/**
 * The API inside Vite's dev server, so `npm run dev` is the whole game: requests under /api go
 * to the same handler production runs, against a register in data/dev.sqlite.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plugin } from 'vite';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';

export function anamnesiaApi(dbPath = 'data/dev.sqlite'): Plugin {
  return {
    name: 'anamnesia-api',
    configureServer(server) {
      mkdirSync(dirname(dbPath), { recursive: true });
      const app = createApp({ db: openDatabase(dbPath), staticDir: null });
      server.middlewares.use((req, res, next) => {
        const path = req.url ?? '';
        if (path === '/api' || path.startsWith('/api/') || path.startsWith('/api?')) app(req, res);
        else next();
      });
    },
  };
}
