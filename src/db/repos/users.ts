import { asc, eq, sql } from 'drizzle-orm';

import { users, type User } from '../schema.ts';
import type { Db } from '../index.ts';

export type CreateUserInput = {
  username: string;
  passwordHash: string;
  displayName: string;
  isAdmin: boolean;
};

/**
 * Insert a new user. `rotation_order` is assigned atomically as
 * max(existing) + 1 via a scalar subquery, so join order == creation order.
 * Throws on duplicate username (unique index is case-insensitive).
 */
export async function createUser(db: Db, input: CreateUserInput, now: number): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      isAdmin: input.isAdmin,
      rotationOrder: sql`(SELECT COALESCE(MAX(${users.rotationOrder}), 0) + 1 FROM ${users})`,
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
    .orderBy(asc(users.rotationOrder));
}

export async function listAllUsers(db: Db): Promise<User[]> {
  return db.select().from(users).orderBy(asc(users.rotationOrder));
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

/** Single-order write for admins nudging one slot. */
export async function setRotationOrder(db: Db, id: number, order: number): Promise<User> {
  const [user] = await db
    .update(users)
    .set({ rotationOrder: order })
    .where(eq(users.id, id))
    .returning();
  return user;
}

/**
 * Batch assignment for admin reordering: the ids of the active members in
 * their intended rotation order. Normalizes to 1..n inside a transaction
 * and leaves inactive rows untouched.
 */
export async function setRotationOrders(db: Db, orderedIds: number[]): Promise<User[]> {
  const updated: User[] = [];
  db.transaction((tx) => {
    let order = 1;
    for (const id of orderedIds) {
      const rows = tx
        .update(users)
        .set({ rotationOrder: order++ })
        .where(eq(users.id, id))
        .returning()
        .all();
      if (rows.length > 0) updated.push(rows[0]);
    }
  });
  return updated;
}
