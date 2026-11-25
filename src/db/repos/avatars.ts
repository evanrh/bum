import { eq } from 'drizzle-orm';

import { avatars, type Avatar } from '../schema.ts';
import type { Db } from '../index.ts';

/**
 * Profile pictures (issue #50) — one optional row per member. Kept separate
 * from `users` so session resolution and member listings never load image
 * bytes; only the serving route and settings flow touch this table.
 */

/** Avatar row without the bytes — cheap presence/version checks. */
export type AvatarMeta = Pick<Avatar, 'userId' | 'contentType' | 'updatedAt'>;

export type AvatarBytes = { contentType: string; data: Buffer };

/** Upsert (one row per member: PK user_id, last upload wins). */
export async function setAvatar(
  db: Db,
  userId: number,
  avatar: AvatarBytes,
  now: number,
): Promise<AvatarMeta> {
  const [row] = await db
    .insert(avatars)
    .values({ userId, contentType: avatar.contentType, data: avatar.data, updatedAt: now })
    .onConflictDoUpdate({
      target: avatars.userId,
      set: { contentType: avatar.contentType, data: avatar.data, updatedAt: now },
    })
    .returning({ userId: avatars.userId, contentType: avatars.contentType, updatedAt: avatars.updatedAt });
  return row;
}

export async function clearAvatar(db: Db, userId: number): Promise<boolean> {
  const result = await db.delete(avatars).where(eq(avatars.userId, userId));
  return Number(result.changes) > 0;
}

export async function getAvatarMeta(db: Db, userId: number): Promise<AvatarMeta | undefined> {
  const [row] = await db
    .select({ userId: avatars.userId, contentType: avatars.contentType, updatedAt: avatars.updatedAt })
    .from(avatars)
    .where(eq(avatars.userId, userId))
    .limit(1);
  return row;
}

export async function getAvatarBytes(db: Db, userId: number): Promise<AvatarBytes | undefined> {
  const [row] = await db
    .select({ contentType: avatars.contentType, data: avatars.data })
    .from(avatars)
    .where(eq(avatars.userId, userId))
    .limit(1);
  return row;
}
