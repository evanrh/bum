import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, appliedMigrationCount } from '../../src/db/migrate.ts';
import { createDatabase, type Db } from '../../src/db/index.ts';
import * as auditRepo from '../../src/db/repos/audit.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import { hash } from './helpers.ts';

let db: Db;
let stageDir: string;
let originalMigrationsDir: string | undefined;

beforeEach(() => {
  db = createDatabase(':memory:');
  stageDir = mkdtempSync(path.join(tmpdir(), 'bum-migrate-stage-'));
  originalMigrationsDir = process.env.BUM_MIGRATIONS_DIR;
});

afterEach(() => {
  db.$client.close();
  rmSync(stageDir, { recursive: true, force: true });
  if (originalMigrationsDir === undefined) delete process.env.BUM_MIGRATIONS_DIR;
  else process.env.BUM_MIGRATIONS_DIR = originalMigrationsDir;
});

/** Copy the committed migrations up to and including `tag` into the stage dir. */
function stageThrough(tag: string): void {
  // The repo's drizzle/ folder — NOT migrationsFolder(), which follows
  // BUM_MIGRATIONS_DIR and would point at the stage itself once set.
  const real = fileURLToPath(new URL('../../drizzle/', import.meta.url));
  mkdirSync(path.join(stageDir, 'meta'), { recursive: true });
  copyFileSync(path.join(real, `${tag}.sql`), path.join(stageDir, `${tag}.sql`));
  const prefix = tag.split('_')[0];
  copyFileSync(
    path.join(real, 'meta', `${prefix}_snapshot.json`),
    path.join(stageDir, 'meta', `${prefix}_snapshot.json`),
  );
  const full = JSON.parse(readFileSync(path.join(real, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
    [key: string]: unknown;
  };
  const entries = full.entries.slice(0, full.entries.findIndex((e) => e.tag === tag) + 1);
  writeFileSync(
    path.join(stageDir, 'meta', '_journal.json'),
    JSON.stringify({ ...full, entries }),
  );
  process.env.BUM_MIGRATIONS_DIR = stageDir;
}

const tables = (database: Db): string[] =>
  (
    database.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);

const columns = (database: Db, table: string): string[] =>
  (database.$client.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (r) => r.name,
  );

describe('rotation-model migration (0001)', () => {
  it('applies on top of a 0000-migrated database without losing data', () => {
    stageThrough('0000_nostalgic_ozymandias');
    applyMigrations(db);

    // Baseline: the T01 shape.
    expect(tables(db)).toContain('skipped_turns');
    expect(columns(db, 'settings')).toEqual(
      expect.arrayContaining([
        'rotation_epoch',
        'week_start_day',
        'week_start_hour',
        'timezone',
        'rotation_offset',
        'last_reconciled_week',
      ]),
    );
    expect(columns(db, 'users')).toContain('rotation_order');

    // Seed data in the OLD shape (raw SQL — the repos have moved on).
    db.$client
      .prepare(
        `INSERT INTO settings
           (id, group_name, join_code_hash, joining_enabled, rotation_epoch,
            week_start_day, week_start_hour, timezone, rotation_offset, created_at, updated_at)
         VALUES (1, 'Bum', 'hash', 1, '2026-01-05', 1, 0, 'UTC', 0, 1, 1)`,
      )
      .run();
    db.$client
      .prepare(
        `INSERT INTO users
           (username, password_hash, display_name, is_admin, is_active, rotation_order, joined_at)
         VALUES ('bob', 'h', 'Bob', 0, 1, 2, 1)`,
      )
      .run();

    // Upgrade: bring the rotation-model migration into the stage and apply.
    stageThrough('0001_curved_cloak');
    applyMigrations(db);
    expect(appliedMigrationCount(db)).toBe(2);

    expect(tables(db)).not.toContain('skipped_turns');
    expect(tables(db)).toContain('audit_log');

    const settingsColumns = columns(db, 'settings');
    expect(settingsColumns).toEqual(expect.arrayContaining(['rotation', 'last_rotated_week']));
    expect(settingsColumns).toEqual(
      expect.not.arrayContaining([
        'rotation_epoch',
        'week_start_day',
        'week_start_hour',
        'timezone',
        'rotation_offset',
        'last_reconciled_week',
      ]),
    );
    expect(columns(db, 'users')).toEqual(expect.not.arrayContaining(['rotation_order']));

    // Existing rows survived; the new columns carry their defaults.
    const settingsRow = db.$client
      .prepare('SELECT group_name, rotation, last_rotated_week FROM settings WHERE id = 1')
      .get() as { group_name: string; rotation: string; last_rotated_week: string | null };
    expect(settingsRow.group_name).toBe('Bum');
    expect(settingsRow.rotation).toBe('[]');
    expect(settingsRow.last_rotated_week).toBeNull();

    const userRow = db.$client
      .prepare('SELECT username, display_name FROM users WHERE username = ?')
      .get('bob') as { username: string; display_name: string };
    expect(userRow.display_name).toBe('Bob');
  });

  it('audit repo works against the migrated schema (system + admin actors)', async () => {
    stageThrough('0000_nostalgic_ozymandias');
    stageThrough('0001_curved_cloak');
    applyMigrations(db);

    const bob = await usersRepo.createUser(
      db,
      { username: 'bob', passwordHash: hash('x'), displayName: 'Bob', isAdmin: false },
      100,
    );
    await auditRepo.recordAudit(
      db,
      { actorUserId: null, action: 'queue.advance', detail: 'advanced for week 2026-01-05' },
      1000,
    );
    await auditRepo.recordAudit(
      db,
      { actorUserId: bob.id, action: 'queue.override', detail: 'bob moved to the back' },
      2000,
    );

    const entries = await auditRepo.listRecentAudit(db);
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('queue.override');
    expect(entries[0].actorUsername).toBe('bob');
    expect(entries[0].actorDisplayName).toBe('Bob');
    expect(entries[1].action).toBe('queue.advance');
    expect(entries[1].actorUsername).toBeNull();
    expect(entries[1].actorDisplayName).toBeNull();
    expect(await auditRepo.listRecentAudit(db, 1)).toHaveLength(1);
  });
});
