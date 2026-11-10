import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { createDatabase, databasePath, type Db } from './index.ts';

/**
 * Locate the migrations folder. Override with BUM_MIGRATIONS_DIR when the
 * layout differs from the repo (e.g. inside the Docker image).
 */
export function migrationsFolder(): string {
  if (process.env.BUM_MIGRATIONS_DIR) return process.env.BUM_MIGRATIONS_DIR;
  // src/db/migrate.ts → project root /drizzle. Also correct once bundled to
  // dist/jobs/migrate.mjs in the Docker image (../../drizzle stays at the root).
  return fileURLToPath(new URL('../../drizzle/', import.meta.url));
}

/**
 * Apply all pending SQL migrations from `drizzle/` through drizzle-orm's
 * programmatic runner (no drizzle-kit in production). Idempotent: the
 * journal table makes repeat calls no-ops.
 */
export function applyMigrations(db: Db): void {
  const folder = migrationsFolder();
  if (!existsSync(path.join(folder, 'meta'))) {
    throw new Error(`no migrations found in ${folder} — run \`npm run db:generate\` first`);
  }
  migrate(db, { migrationsFolder: folder });
}

/** Number of recorded journal entries (one per applied migration file). */
export function appliedMigrationCount(db: Db): number {
  const result = db.$client
    .prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations')
    .get() as { n: number | bigint };
  return Number(result.n);
}

const isMainModule = (): boolean => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
};

// CLI entry: `node src/db/migrate.ts`
if (isMainModule()) {
  const db = createDatabase();
  applyMigrations(db);
  console.log(`[bum] migrations applied — journal entries: ${appliedMigrationCount(db)}`);
}
