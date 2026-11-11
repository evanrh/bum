import bcrypt from 'bcryptjs';
import { applyMigrations } from '../../src/db/migrate.ts';
import { createDatabase, type Db } from '../../src/db/index.ts';
import * as usersRepo from '../../src/db/repos/users.ts';

/**
 * Open an isolated :memory: database with migrations applied. WAL semantics
 * genuinely matter only for multi-process setups (Docker), exercised in T09;
 * everything unit-level here is satisfied by :memory:.
 */
export function makeDb(): Db {
  const db = createDatabase(':memory:');
  applyMigrations(db);
  return db;
}

/** Test hash cost — the real cost (12) is exercised by auth tests in T03. */
export const TEST_BCRYPT_COST = 4;

export function hash(password: string): string {
  return bcrypt.hashSync(password, TEST_BCRYPT_COST);
}

export type FixtureMembers = {
  admin: { id: number };
  bob: { id: number };
  carol: { id: number };
  dave: { id: number };
};

/** Four members in creation order: bob, carol, dave, admin. */
export async function seedMembers(db: Db, now: number = 1_000_000): Promise<FixtureMembers> {
  const make = async (username: string, isAdmin: boolean) =>
    await usersRepo.createUser(
      db,
      { username, passwordHash: hash(`pw-${username}`), displayName: username, isAdmin },
      now,
    );
  const bob = await make('bob', false);
  const carol = await make('carol', false);
  const dave = await make('dave', false);
  const admin = await make('admin', true);
  return { admin: { id: admin.id }, bob: { id: bob.id }, carol: { id: carol.id }, dave: { id: dave.id } };
}
