import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createDatabase } from '../db/index.ts';
import { applyMigrations } from '../db/migrations.ts';
import { backfillCovers } from '../lib/covers.ts';

/**
 * One-shot cover backfill (issue #14) — re-resolves cover art for every
 * album row with a null cover_url and stores it in the DB (same semantics
 * as the insert path). Idempotent: rows with a cover are never re-touched.
 *
 * CLI: `node src/jobs/backfill-covers.ts` (honors DATABASE_URL). Exits 0
 * when every resolvable row landed; 1 when some resolutions failed so the
 * sweep can simply be re-run when the network cooperates.
 */

const isMainModule = (): boolean => {
  try {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href;
  } catch {
    return false;
  }
};

// CLI entry: `node src/jobs/backfill-covers.ts`
if (isMainModule()) {
  const db = createDatabase();
  applyMigrations(db);
  const summary = await backfillCovers(db, { fetch: fetch.bind(globalThis), log: console.log });
  db.$client.close();
  console.log(
    `[covers] done — scanned ${summary.scanned}: ${summary.resolved} resolved, ` +
      `${summary.failed} failed, ${summary.unresolvable} had no external ids`,
  );
  process.exit(summary.failed > 0 ? 1 : 0);
}
