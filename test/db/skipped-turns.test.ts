import { beforeEach, describe, expect, it } from 'vitest';

import * as skippedTurnsRepo from '../../src/db/repos/skipped-turns.ts';
import { makeDb, seedMembers, type FixtureMembers } from './helpers.ts';
import type { Db } from '../../src/db/index.ts';

let db: Db;
let fixture: FixtureMembers;
const now = 3_000_000;

beforeEach(async () => {
  db = makeDb();
  fixture = await seedMembers(db, 1_000_000);
});

describe('skipped turns repo', () => {
  it('records a row once per (week, user); repeats and kind-changes no-op', async () => {
    expect(
      await skippedTurnsRepo.recordSkippedTurn(db, { weekStart: '2026-01-05', userId: fixture.bob.id, kind: 'auto' }, now),
    ).toBe(true);
    expect(
      await skippedTurnsRepo.recordSkippedTurn(db, { weekStart: '2026-01-05', userId: fixture.bob.id, kind: 'auto' }, now + 1),
    ).toBe(false);
    expect(
      await skippedTurnsRepo.recordSkippedTurn(db, { weekStart: '2026-01-05', userId: fixture.bob.id, kind: 'admin' }, now + 2),
    ).toBe(false);
    const rows = await skippedTurnsRepo.listSkippedTurnsForWeek(db, '2026-01-05');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('auto');
    expect(rows[0].recordedAt).toBe(now);
  });

  it('the same member can be skipped in different weeks, and different members in the same week', async () => {
    expect(
      await skippedTurnsRepo.recordSkippedTurn(db, { weekStart: '2026-01-05', userId: fixture.bob.id, kind: 'auto' }, now),
    ).toBe(true);
    expect(
      await skippedTurnsRepo.recordSkippedTurn(db, { weekStart: '2026-01-12', userId: fixture.bob.id, kind: 'admin' }, now),
    ).toBe(true);
    expect(
      await skippedTurnsRepo.recordSkippedTurn(db, { weekStart: '2026-01-05', userId: fixture.carol.id, kind: 'admin' }, now),
    ).toBe(true);
    expect(await skippedTurnsRepo.listRecentSkippedTurns(db)).toHaveLength(3);
  });

  it('rejects unknown kinds via the CHECK constraint', () => {
    expect(() =>
      db.$client
        .prepare(
          `INSERT INTO skipped_turns (week_start, user_id, kind, recorded_at) VALUES ('2026-01-05', ?, 'human', ?)`,
        )
        .run(fixture.bob.id, now),
    ).toThrow(/CHECK constraint failed/);
  });

  it('listRecent joins display names and sorts newest week first', async () => {
    await skippedTurnsRepo.recordSkippedTurn(db, { weekStart: '2026-01-05', userId: fixture.bob.id, kind: 'auto' }, now);
    await skippedTurnsRepo.recordSkippedTurn(db, { weekStart: '2026-01-12', userId: fixture.carol.id, kind: 'admin' }, now);
    const rows = await skippedTurnsRepo.listRecentSkippedTurns(db);
    expect(rows.map((r) => [r.weekStart, r.username, r.kind])).toEqual([
      ['2026-01-12', 'carol', 'admin'],
      ['2026-01-05', 'bob', 'auto'],
    ]);
  });
});
