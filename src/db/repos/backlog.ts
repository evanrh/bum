import { asc, eq, and, sql } from 'drizzle-orm';

import { backlogItems, type BacklogItem } from '../schema.ts';
import type { Db } from '../index.ts';

/**
 * The per-member album backlog (issue #18): an ordered list of prepared
 * submissions. The head (lowest position) is used for the member's weekly
 * pick when auto-queueing is on. Framework-agnostic, explicit-Db, like the
 * other repos.
 */

export type NewBacklogItem = {
  id: string;
  userId: number;
  title: string;
  artist: string;
  year?: number | null;
  spotifyId?: string | null;
  youtubeId?: string | null;
  coverUrl?: string | null;
  note?: string | null;
};

/** The member's backlog, head first (order = the queue). */
export async function listBacklogItems(db: Db, userId: number): Promise<BacklogItem[]> {
  return db
    .select()
    .from(backlogItems)
    .where(eq(backlogItems.userId, userId))
    .orderBy(asc(backlogItems.position), asc(backlogItems.createdAt));
}

/** Back of the queue: one past the highest position (gaps are fine). */
export async function nextPosition(db: Db, userId: number): Promise<number> {
  const [row] = await db
    .select({ tail: sql<number | null>`max(${backlogItems.position})` })
    .from(backlogItems)
    .where(eq(backlogItems.userId, userId));
  const tail = row?.tail === null || row?.tail === undefined ? 0 : Number(row.tail);
  return tail + 1;
}

export async function appendBacklogItem(db: Db, item: NewBacklogItem, now: number): Promise<BacklogItem> {
  const [created] = await db
    .insert(backlogItems)
    .values({
      id: item.id,
      userId: item.userId,
      title: item.title,
      artist: item.artist,
      year: item.year ?? null,
      spotifyId: item.spotifyId ?? null,
      youtubeId: item.youtubeId ?? null,
      coverUrl: item.coverUrl ?? null,
      note: item.note ?? null,
      position: await nextPosition(db, item.userId),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

export async function getBacklogItem(db: Db, id: string, userId: number): Promise<BacklogItem | undefined> {
  const [row] = await db
    .select()
    .from(backlogItems)
    .where(and(eq(backlogItems.id, id), eq(backlogItems.userId, userId)))
    .limit(1);
  return row;
}

export async function removeBacklogItem(db: Db, id: string, userId: number): Promise<boolean> {
  const result = await db
    .delete(backlogItems)
    .where(and(eq(backlogItems.id, id), eq(backlogItems.userId, userId)));
  return Number(result.changes) > 0;
}

export type RepositionInput = { id: string; position: number };

/** Rewrite the member's positions entirely (the reorder endpoint's contract). */
export async function repositionBacklog(db: Db, userId: number, ordered: RepositionInput[], now: number): Promise<void> {
  for (const entry of ordered) {
    await db
      .update(backlogItems)
      .set({ position: entry.position, updatedAt: now })
      .where(and(eq(backlogItems.id, entry.id), eq(backlogItems.userId, userId)));
  }
}

/** The head item — the one the weekly advance uses. */
export async function backlogHead(db: Db, userId: number): Promise<BacklogItem | undefined> {
  return (await listBacklogItems(db, userId))[0];
}
