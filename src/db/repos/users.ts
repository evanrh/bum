import { asc, eq, inArray, sql } from 'drizzle-orm';

import { users, type User } from '../schema.ts';
import type { Db } from '../index.ts';

export type CreateUserInput = {
  username: string;
  passwordHash: string;
  displayName: string;
  isAdmin: boolean;
};

/**
 * Insert a new user. Join order == creation order (`joined_at`); the
 * rotation order lives in the settings queue, not on the row. Throws on
 * duplicate username (unique index is case-insensitive).
 */
export async function createUser(db: Db, input: CreateUserInput, now: number): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      isAdmin: input.isAdmin,
      joinedAt: now,
    })
    .returning();
  return user;
}

export async function getUserById(db: Db, id: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

/** Case-insensitive lookup is provided by the `lower(username)` unique index. */
export async function getUserByUsername(db: Db, username: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  return user;
}

export async function countUsers(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(users);
  return Number(row.n);
}

export async function listActiveUsers(db: Db): Promise<User[]> {
  return db
    .select()
    .from(users)
    .where(eq(users.isActive, true))
    // Join order == creation order; id is the deterministic tiebreaker.
    .orderBy(asc(users.joinedAt), asc(users.id));
}

export async function listAllUsers(db: Db): Promise<User[]> {
  return db.select().from(users).orderBy(asc(users.joinedAt), asc(users.id));
}

/** Batch lookup for page rendering (submitter names on album lists). */
export async function getUsersByIds(db: Db, ids: number[]): Promise<User[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(users)
    .where(inArray(users.id, ids))
    .orderBy(asc(users.joinedAt), asc(users.id));
}

export async function setUserAdmin(db: Db, id: number, isAdmin: boolean): Promise<User> {
  const [user] = await db
    .update(users)
    .set({ isAdmin })
    .where(eq(users.id, id))
    .returning();
  return user;
}

export async function setUserActive(db: Db, id: number, isActive: boolean): Promise<User> {
  const [user] = await db
    .update(users)
    .set({ isActive })
    .where(eq(users.id, id))
    .returning();
  return user;
}

export async function setUserPassword(db: Db, id: number, passwordHash: string): Promise<User> {
  const [user] = await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, id))
    .returning();
  return user;
}
