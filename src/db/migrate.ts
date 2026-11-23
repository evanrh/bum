import { pathToFileURL } from 'node:url';

import { migrateDatabase } from './migrations.ts';

// Re-exported for existing importers (tests, the jobs runner); the actual
// runner lives in ./migrations.ts so bundles importing it don't run this
// CLI block (issue #39).
export { applyMigrations, appliedMigrationCount, migrationsFolder } from './migrations.ts';

const isMainModule = (): boolean => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
};

// CLI entry: `node src/db/migrate.ts`
if (isMainModule()) {
  const { count } = migrateDatabase();
  console.log(`[bum] migrations applied — journal entries: ${count}`);
}
