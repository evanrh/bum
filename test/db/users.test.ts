import { beforeEach, describe, expect, it } from 'vitest';

import * as usersRepo from '../../src/db/repos/users.ts';
import { hash, makeDb, seedMembers } from './helpers.ts';

let db: ReturnType<typeof makeDb>;

beforeEach(async () => {
  db = makeDb();
});

describe('users repo', () => {
  it('createUser assigns sequential rotation_order in join order', async () => {
    const now = 1;
    const a = await usersRepo.createUser(db, { username: 'alice', passwordHash: hash('x'), displayName: 'A', isAdmin: true }, now);
    const b = await usersRepo.createUser(db, { username: 'brad', passwordHash: hash('x'), displayName: 'B', isAdmin: false }, now);
    const c = await usersRepo.createUser(db, { username: 'cyd', passwordHash: hash('x'), displayName: 'C', isAdmin: false }, now);
    expect(a.rotationOrder).toBe(1);
    expect(b.rotationOrder).toBe(2);
    expect(c.rotationOrder).toBe(3);
  });

  it('rejects duplicate usernames case-insensitively', async () => {
    await usersRepo.createUser(db, { username: 'alice', passwordHash: hash('x'), displayName: 'A', isAdmin: true }, 1);
    await expect(
      usersRepo.createUser(db, { username: 'ALICE', passwordHash: hash('x'), displayName: 'A2', isAdmin: false }, 2),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
  });

  it('deactivated members leave listActive but stay in listAll, and keep their username reserved', async () => {
    const fixture = await seedMembers(db);
    await usersRepo.setUserActive(db, fixture.bob.id, false);
    const actives = await usersRepo.listActiveUsers(db);
    const all = await usersRepo.listAllUsers(db);
    expect(actives.map((u) => u.username)).toEqual(['carol', 'dave', 'admin']);
    expect(all).toHaveLength(4);
    await expect(
      usersRepo.createUser(db, { username: 'BOB', passwordHash: hash('x'), displayName: 'Bob II', isAdmin: false }, 3),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
    // Reactivation keeps the historical rotation slot.
    const reactivated = await usersRepo.setUserActive(db, fixture.bob.id, true);
    expect(reactivated.rotationOrder).toBe(1);
    expect((await usersRepo.listActiveUsers(db)).map((u) => u.username)).toEqual(['bob', 'carol', 'dave', 'admin']);
  });

  it('countUsers counts rows', async () => {
    expect(await usersRepo.countUsers(db)).toBe(0);
    await seedMembers(db);
    expect(await usersRepo.countUsers(db)).toBe(4);
  });

  it('getUserById / getUserByUsername resolve (username lookup is case-insensitive)', async () => {
    const fixture = await seedMembers(db);
    expect((await usersRepo.getUserById(db, fixture.carol.id))?.username).toBe('carol');
    expect((await usersRepo.getUserByUsername(db, 'CAROL'))?.id).toBe(fixture.carol.id);
    expect(await usersRepo.getUserByUsername(db, 'nobody')).toBeUndefined();
  });

  it('setAdmin / setActive persist', async () => {
    const fixture = await seedMembers(db);
    const promoted = await usersRepo.setUserAdmin(db, fixture.bob.id, true);
    expect(promoted.isAdmin).toBe(true);
    const deactivated = await usersRepo.setUserActive(db, fixture.carol.id, false);
    expect(deactivated.isActive).toBe(false);
  });

  it('setUserPassword stores a verifiable-looking hash', async () => {
    const fixture = await seedMembers(db);
    const updated = await usersRepo.setUserPassword(db, fixture.bob.id, hash('new-secret'));
    expect(updated.passwordHash).not.toBe(hash('pw-bob'));
  });

  it('setRotationOrders normalizes 1..n for the given order and leaves the rest untouched', async () => {
    const fixture = await seedMembers(db);
    const updated = await usersRepo.setRotationOrders(db, [fixture.dave.id, fixture.admin.id, fixture.bob.id, fixture.carol.id]);
    const all = await usersRepo.listAllUsers(db);
    expect(updated).toHaveLength(4);
    expect(all.map((u) => [u.username, u.rotationOrder])).toEqual([
      ['dave', 1],
      ['admin', 2],
      ['bob', 3],
      ['carol', 4],
    ]);
  });

  it('setRotationOrder writes a single slot', async () => {
    const fixture = await seedMembers(db);
    const updated = await usersRepo.setRotationOrder(db, fixture.bob.id, 10);
    expect(updated.rotationOrder).toBe(10);
  });
});
