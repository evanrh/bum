import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { createDatabase, type Db } from './index.ts';

/**
 * The migration runner, CLI-free (issue #39): every non-CLI importer (the
 * boot entrypoint, the jobs runner, tests) must apply migrations through
 * this module. `src/db/migrate.ts` is the thin CLI shim for manual runs —
 * its isMainModule guard would run its own migrations inside ANY bundle
 * that imports this module from there, which is how boot.mjs ended up
 * migrating before its env preflight.
 */

/**
 * Locate the migrations folder. Override with BUM_MIGRATIONS_DIR when the
 * layout differs from the repo (e.g. inside the Docker image).
 */
export function migrationsFolder(): string {
  if (process.env.BUM_MIGRATIONS_DIR) return process.env.BUM_MIGRATIONS_DIR;
  // src/db/migrations.ts → project root /drizzle. Also correct once bundled
  // to dist/jobs/*.mjs in the Docker image (../../drizzle stays at the root).
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

/** Open the configured database and apply migrations — the boot sequence. */
export function migrateDatabase(): { db: Db; count: number } {
  const db = createDatabase();
  applyMigrations(db);
  return { db, count: appliedMigrationCount(db) };
}
