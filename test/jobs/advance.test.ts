import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as albumsRepo from '../../src/db/repos/albums.ts';
import * as auditRepo from '../../src/db/repos/audit.ts';
import * as backlogRepo from '../../src/db/repos/backlog.ts';
import * as settingsRepo from '../../src/db/repos/settings.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import type { Db } from '../../src/db/index.ts';
import { advanceRotation } from '../../src/jobs/advance.ts';
import { runOnce } from '../../src/jobs/run.ts';
import { makeDb, seedMembers, type FixtureMembers } from '../db/helpers.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_WEEK = '2026-01-05'; // a Monday

let db: Db;
let members: FixtureMembers;
let logs: string[];
let envBackup: string | undefined;

const runAt = (weekStartISO: string, offsetDays = 1): Promise<void> =>
  advanceRotation(db, {
    now: new Date(Date.parse(weekStartISO) + offsetDays * DAY_MS), // a Tuesday-in-week instant
    log: (message) => logs.push(message),
  });

const queueNames = async (): Promise<Array<string | undefined>> => {
  const namesById = new Map((await usersRepo.listAllUsers(db)).map((u) => [u.id, u.username]));
  return (await settingsRepo.getRotation(db)).map((id) => namesById.get(id));
};

const checkpoint = async (): Promise<string | null> => (await settingsRepo.getSettings(db)).lastRotatedWeek;

beforeEach(async () => {
  envBackup = process.env.BOOTSTRAP_JOIN_CODE;
  process.env.BOOTSTRAP_JOIN_CODE = 'JOINCODE123'; // silent bootstrap
  db = makeDb();
  members = await seedMembers(db);
  await settingsRepo.setRotation(db, [members.bob.id, members.carol.id, members.dave.id, members.admin.id], 1000);
  logs = [];
});

afterEach(() => {
  if (envBackup === undefined) delete process.env.BOOTSTRAP_JOIN_CODE;
  else process.env.BOOTSTRAP_JOIN_CODE = envBackup;
});

describe('advanceRotation', () => {
  it('bootstrap run: checkpoint set, no rotation, no audit rows', async () => {
    await runAt(BASE_WEEK);
    expect(await checkpoint()).toBe(BASE_WEEK);
    expect(await queueNames()).toEqual(['bob', 'carol', 'dave', 'admin']);
    expect(await auditRepo.listRecentAudit(db, 100)).toHaveLength(0);
    expect(logs.some((l) => l.includes('bootstrap'))).toBe(true);
  });

  it('one elapsed week → single advance, one audit row, checkpoint moved', async () => {
    await runAt(BASE_WEEK);
    await runAt('2026-01-12');
    expect(await queueNames()).toEqual(['carol', 'dave', 'admin', 'bob']);
    expect(await checkpoint()).toBe('2026-01-12');

    const audits = await auditRepo.listRecentAudit(db, 100);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('queue.advance');
    expect(audits[0].actorUsername).toBeNull(); // system actor
    expect(audits[0].detail).toContain('2026-01-12');
  });

  it('3-week downtime → exactly 3 advances in order, each audited; rerun is a no-op', async () => {
    await runAt(BASE_WEEK);
    await runAt('2026-01-26'); // three weeks later

    expect(await queueNames()).toEqual(['admin', 'bob', 'carol', 'dave']);
    expect(await checkpoint()).toBe('2026-01-26');
    const audits = await auditRepo.listRecentAudit(db, 100);
    expect(audits).toHaveLength(3);
    // Newest first: the audit details name the weeks oldest → newest.
    expect(audits[2].detail).toContain('2026-01-12');
    expect(audits[1].detail).toContain('2026-01-19');
    expect(audits[0].detail).toContain('2026-01-26');

    // Repeat run (the daily cron): nothing happens.
    const auditCountBefore = (await auditRepo.listRecentAudit(db, 100)).length;
    await runAt('2026-01-26');
    expect((await auditRepo.listRecentAudit(db, 100)).length).toBe(auditCountBefore);
    expect(await checkpoint()).toBe('2026-01-26');
    expect(logs.some((l) => l.includes('0 week(s) advanced'))).toBe(true);
  });

  it('same-week reruns (daily cron) → nothing happens', async () => {
    await runAt(BASE_WEEK);
    await runAt('2026-01-12');
    await runAt('2026-01-12');
    await runAt('2026-01-12');
    expect(await queueNames()).toEqual(['carol', 'dave', 'admin', 'bob']);
    expect((await auditRepo.listRecentAudit(db, 100)).length).toBeLessThanOrEqual(1);
  });

  it('empty queue → no rotation, no audit rows, checkpoint still advances', async () => {
    await runAt(BASE_WEEK); // bootstrap
    await settingsRepo.setRotation(db, [], Date.now());
    await runAt('2026-01-12');
    expect(await queueNames()).toEqual([]);
    expect(await checkpoint()).toBe('2026-01-12');
    expect(await auditRepo.listRecentAudit(db, 100)).toHaveLength(0);
  });

  it('a DST-spanning range advances exactly once per calendar week', async () => {
    // 2026-03-02 → 2026-03-23 spans the spring-forward transition (Mar 8).
    await runAt('2026-03-02');
    await runAt('2026-03-23');
    expect(await checkpoint()).toBe('2026-03-23');
    expect(await auditRepo.listRecentAudit(db, 100)).toHaveLength(3);
    expect(await settingsRepo.getRotation(db)).toEqual(
      JSON.parse(JSON.stringify(await settingsRepo.getRotation(db))),
    );
  });

  describe('backlog auto-queue (issue #18)', () => {
    it("the new picker's queued head becomes the week's album; the rest stays queued", async () => {
      await runAt(BASE_WEEK); // bootstrap: bob picks BASE_WEEK
      // After the next advance the head is carol — queue for the real future picker.
      await backlogRepo.appendBacklogItem(
        db,
        { id: crypto.randomUUID(), userId: members.carol.id, title: 'Carol Queued One', artist: 'QA', year: 1974, note: 'from the backlog' },
        Date.now(),
      );
      await backlogRepo.appendBacklogItem(
        db,
        { id: crypto.randomUUID(), userId: members.carol.id, title: 'Carol Queued Two', artist: 'QB', year: 1975 },
        Date.now(),
      );

      await runAt('2026-01-12'); // carol's turn now
      const album = await albumsRepo.getAlbumByWeekStart(db, '2026-01-12');
      expect(album).toMatchObject({ title: 'Carol Queued One', submittedBy: members.carol.id, weekStart: '2026-01-12' });
      expect((await backlogRepo.listBacklogItems(db, members.carol.id)).map((i) => i.title)).toEqual(['Carol Queued Two']);
      const audits = await auditRepo.listRecentAudit(db, 100);
      expect(audits[0].action).toBe('backlog.auto_submit');
      expect(audits[0].actorUsername).toBeNull();
      expect(audits[0].detail).toContain('Carol Queued One');
    });

    it('bootstrap also uses the head picker (their week is starting right then)', async () => {
      await backlogRepo.appendBacklogItem(
        db,
        { id: crypto.randomUUID(), userId: members.bob.id, title: 'Bootstrap Pick', artist: 'QA' },
        Date.now(),
      );
      await runAt(BASE_WEEK); // checkpoint was null → bootstrap; bob's turn starts
      expect((await albumsRepo.getAlbumByWeekStart(db, BASE_WEEK))?.title).toBe('Bootstrap Pick');
      expect(await backlogRepo.listBacklogItems(db, members.bob.id)).toHaveLength(0);
    });

    it('auto-queueing off → the week stays empty and the backlog is untouched', async () => {
      await runAt(BASE_WEEK);
      const bobRow = (await usersRepo.getUserById(db, members.bob.id))!;
      await usersRepo.setAutoBacklog(db, bobRow.id, false);
      await backlogRepo.appendBacklogItem(
        db,
        { id: crypto.randomUUID(), userId: members.bob.id, title: 'Bob Queued', artist: 'QA' },
        Date.now(),
      );
      await runAt('2026-01-12');
      expect(await albumsRepo.getAlbumByWeekStart(db, '2026-01-12')).toBeUndefined();
      expect(await backlogRepo.listBacklogItems(db, members.bob.id)).toHaveLength(1);
    });

    it('no backlog → nothing happens (no extra audit rows)', async () => {
      await runAt(BASE_WEEK);
      const before = (await auditRepo.listRecentAudit(db, 100)).length;
      await settingsRepo.setRotation(db, [members.carol.id, members.bob.id], Date.now());
      await runAt('2026-01-12'); // carol has no backlog
      expect((await auditRepo.listRecentAudit(db, 100)).length).toBe(before + 1); // just the advance
      expect(await albumsRepo.getAlbumByWeekStart(db, '2026-01-12')).toBeUndefined();
    });
  });
});

describe('runOnce (JOBS_CRON=off path)', () => {
  it('advances exactly like advanceRotation and returns normally', async () => {
    const captured: string[] = [];
    await runOnce(db, { now: new Date(Date.parse(BASE_WEEK) + DAY_MS), log: (m) => captured.push(m) });
    expect(await checkpoint()).toBe(BASE_WEEK);
    await runOnce(db, { now: new Date(Date.parse('2026-01-12') + DAY_MS), log: (m) => captured.push(m) });
    expect(await queueNames()).toEqual(['carol', 'dave', 'admin', 'bob']);
    expect(captured.every((l) => l.startsWith('[bum:jobs]'))).toBe(true);
  });
});
