import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.ts';

/**
 * Drizzle instance plus the underlying better-sqlite3 client (`$client`),
 * used by tests and small raw-SQL touches (e.g. the migration journal).
 */
export type Db = ReturnType<typeof createDatabase>;

/**
 * SQLite database path, overridable for tests and Docker via
 * DATABASE_URL.
 */
export const databasePath = (): string => process.env.DATABASE_URL ?? './data/dev.db';

/**
 * Open a SQLite connection with WAL enabled. The driver is synchronous —
 * fine for this scale and it makes every repository function
 * straightforward to test (see plans/README.md).
 *
 * The inferred return type carries `$client` (the raw better-sqlite3 handle).
 */
export function createDatabase(path: string = databasePath()) {
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
