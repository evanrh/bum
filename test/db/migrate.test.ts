import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appliedMigrationCount, applyMigrations, migrationsFolder } from '../../src/db/migrate.ts';
import { createDatabase, type Db } from '../../src/db/index.ts';

const TABLES = ['settings', 'users', 'sessions', 'albums', 'ratings', 'skipped_turns'];

function tableNames(db: Db): string[] {
  const rows = db.$client.prepare('SELECT name FROM sqlite_master WHERE type = ?').all('table') as Array<{
    name: string;
  }>;
  return rows.map((r) => r.name);
}

describe('migrations', () => {
  it('apply cleanly to an empty database and create all six tables', () => {
    const db = createDatabase(':memory:');
    applyMigrations(db);
    const names = tableNames(db);
    for (const table of TABLES) {
      expect(names).toContain(table);
    }
  });

  it('are idempotent — a second run is a no-op', () => {
    const db = createDatabase(':memory:');
    applyMigrations(db);
    const afterFirst = appliedMigrationCount(db);
    expect(afterFirst).toBeGreaterThan(0);
    applyMigrations(db);
    expect(appliedMigrationCount(db)).toBe(afterFirst);
  });

  it('record one journal entry per migration file (single file in the first release)', () => {
    const db = createDatabase(':memory:');
    applyMigrations(db);
    expect(appliedMigrationCount(db)).toBe(1);
    expect(migrationsFolder()).toMatch(/drizzle\/?$/);
  });

  it('create real database files (parent folders are created recursively)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bum-migrate-'));
    const file = path.join(dir, 'nested', 'test.db');
    try {
      expect(existsSync(file)).toBe(false);
      const db = createDatabase(file);
      applyMigrations(db);
      expect(existsSync(file)).toBe(true);
      db.$client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fail with a clear error when the migrations folder is missing', () => {
    const db = createDatabase(':memory:');
    const original = process.env.BUM_MIGRATIONS_DIR;
    process.env.BUM_MIGRATIONS_DIR = '/definitely/not/a/real/dir';
    try {
      expect(() => applyMigrations(db)).toThrow(/no migrations found/);
    } finally {
      if (original === undefined) delete process.env.BUM_MIGRATIONS_DIR;
      else process.env.BUM_MIGRATIONS_DIR = original;
    }
  });
});
