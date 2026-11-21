import { beforeEach, describe, expect, it } from 'vitest';

import * as backlogRepo from '../../src/db/repos/backlog.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import { makeDb, seedMembers, type FixtureMembers } from './helpers.ts';

let db: ReturnType<typeof makeDb>;
let fixture: FixtureMembers;
const now = 2_000_000;

const addItem = async (userId: number, title: string, position?: number) =>
  backlogRepo.appendBacklogItem(
    db,
    { id: crypto.randomUUID(), userId, title, artist: 'someone', year: 1977 },
    position ?? now,
  );

beforeEach(async () => {
  db = makeDb();
  fixture = await seedMembers(db, 1_000_000);
});

describe('backlog repo', () => {
  it('appends at the back of the member queue (positions climb)', async () => {
    await addItem(fixture.bob.id, 'One');
    await addItem(fixture.bob.id, 'Two');
    const items = await backlogRepo.listBacklogItems(db, fixture.bob.id);
    expect(items.map((i) => i.title)).toEqual(['One', 'Two']);
    expect(items.map((i) => i.position)).toEqual([1, 2]);
    // A gap-free fresh member starts at 1.
    expect(await backlogRepo.nextPosition(db, fixture.carol.id)).toBe(1);
  });

  it('nextPosition climbs past gaps (remove keeps order stable)', async () => {
    const a = await addItem(fixture.bob.id, 'A');
    await addItem(fixture.bob.id, 'B');
    expect(await backlogRepo.removeBacklogItem(db, a.id, fixture.bob.id)).toBe(true);
    expect(await backlogRepo.nextPosition(db, fixture.bob.id)).toBe(3); // positions keep growing
    expect((await backlogRepo.listBacklogItems(db, fixture.bob.id)).map((i) => i.title)).toEqual(['B']);
  });

  it('items are scoped per member (remove/list by owner only)', async () => {
    const bobItem = await addItem(fixture.bob.id, 'Bob pick');
    const carolItem = await addItem(fixture.carol.id, 'Carol pick');
    // Carol cannot touch bob's item: scoped by (id, userId).
    expect(await backlogRepo.removeBacklogItem(db, bobItem.id, fixture.carol.id)).toBe(false);
    expect(await backlogRepo.getBacklogItem(db, bobItem.id, fixture.carol.id)).toBeUndefined();
    expect((await backlogRepo.listBacklogItems(db, fixture.bob.id))).toHaveLength(1);
    // The owner can.
    expect(await backlogRepo.removeBacklogItem(db, carolItem.id, fixture.carol.id)).toBe(true);
  });

  it('reposition rewrites the order and backlogHead follows it', async () => {
    const first = await addItem(fixture.bob.id, 'First');
    const second = await addItem(fixture.bob.id, 'Second');
    const third = await addItem(fixture.bob.id, 'Third');
    expect((await backlogRepo.backlogHead(db, fixture.bob.id))?.id).toBe(first.id);
    // Swap first and third by rewriting positions (gaps fine — order is relative).
    await backlogRepo.repositionBacklog(
      db,
      fixture.bob.id,
      [
        { id: third.id, position: 1 },
        { id: second.id, position: 2 },
        { id: first.id, position: 3 },
      ],
      now,
    );
    expect((await backlogRepo.listBacklogItems(db, fixture.bob.id)).map((i) => i.title)).toEqual([
      'Third',
      'Second',
      'First',
    ]);
    expect((await backlogRepo.backlogHead(db, fixture.bob.id))?.id).toBe(third.id);
  });

  it('the auto-queue toggle defaults on and flips per member', async () => {
    expect((await usersRepo.getUserById(db, fixture.bob.id))?.autoBacklog).toBe(true); // default enabled
    await usersRepo.setAutoBacklog(db, fixture.bob.id, false);
    expect((await usersRepo.getUserById(db, fixture.bob.id))?.autoBacklog).toBe(false);
    await usersRepo.setAutoBacklog(db, fixture.bob.id, true);
    expect((await usersRepo.getUserById(db, fixture.bob.id))?.autoBacklog).toBe(true);
  });
});
