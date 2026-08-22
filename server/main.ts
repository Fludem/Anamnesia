/**
 * The production process: the API and the built game from one port.
 *
 *   PORT              8787
 *   ANAMNESIA_DB      data/anamnesia.sqlite
 *   ANAMNESIA_STATIC  dist (when it exists; set to an empty string for the API alone)
 */
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';

const port = Number(process.env['PORT'] ?? '8787');
const dbPath = process.env['ANAMNESIA_DB'] ?? 'data/anamnesia.sqlite';
const staticEnv = process.env['ANAMNESIA_STATIC'];
const staticDir =
  staticEnv === undefined ? (existsSync('dist/index.html') ? 'dist' : null) : staticEnv || null;

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath);
const server = createServer(createApp({ db, staticDir }));
server.listen(port, () => {
  console.log(
    `anamnesia: http://localhost:${String(port)}/ · register ${dbPath}` +
      (staticDir ? ` · serving ${staticDir}` : ' · api only'),
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
