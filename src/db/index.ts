import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * SQLite database path, overridable for tests and Docker via
 * DATABASE_URL. Populated with real repositories in T01.
 */
export const databasePath = (): string => process.env.DATABASE_URL ?? './data/dev.db';

/**
 * Open a pooled SQLite connection with WAL enabled. Synchronous driver —
 * see plans/README.md ("Data model") for why that is the right call here.
 */
export function createDatabase(path: string = databasePath()): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export { schema };
