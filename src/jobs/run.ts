import cron from 'node-cron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { getDb, type Db } from '../db/index.ts';
import { applyMigrations } from '../db/migrate.ts';
import { TIMEZONE } from '../lib/rotation.ts';
import { advanceRotation, type AdvanceOptions } from './advance.ts';

/**
 * Jobs process entrypoint — node-cron runner advancing the rotation queue.
 * Daily scheduling is belt-and-braces: advanceRotation decides how many
 * weeks were missed, so a missed Monday self-heals on the next run.
 */

export async function runOnce(db: Db, opts: AdvanceOptions = {}): Promise<void> {
  const innerLog = opts.log;
  const log = (message: string): void => {
    const prefixed = `[bum:jobs] ${message}`;
    if (innerLog) innerLog(prefixed);
    else console.log(prefixed);
  };
  await advanceRotation(db, { ...opts, log });
}

const isMainModule = (): boolean => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
};

// CLI entry: `node src/jobs/run.ts` (JOBS_CRON=off runs once and exits).
if (isMainModule()) {
  const db = getDb();
  applyMigrations(db);
  await runOnce(db);

  if (process.env.JOBS_CRON === 'off') {
    console.log('[bum:jobs] JOBS_CRON=off — done, exiting');
    db.$client.close();
    process.exit(0);
  }

  const task = cron.schedule('15 0 * * *', () => {
    void runOnce(getDb());
  }, { timezone: TIMEZONE });

  console.log(`[bum:jobs] jobs runner ready (daily 00:15 ${TIMEZONE})`);

  const shutdown = (signal: NodeJS.Signals): void => {
    task.stop();
    db.$client.close();
    console.log(`[bum:jobs] ${signal} received — shutting down`);
    process.exit(0);
  };
  process.on('SIGTERM', (signal) => shutdown(signal));
  process.on('SIGINT', (signal) => shutdown(signal));
}
