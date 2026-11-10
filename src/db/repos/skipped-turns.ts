import { desc, eq } from 'drizzle-orm';

import { skippedTurns, users, type SkippedTurn } from '../schema.ts';
import type { Db } from '../index.ts';

export type SkippedTurnKind = 'auto' | 'admin';

export type RecordSkippedTurnInput = {
  weekStart: string;
  userId: number;
  kind: SkippedTurnKind;
};

/**
 * Record a skipped turn. UNIQUE(week_start, user_id) allows at most one row
 * per (week, member) — a prior 'admin' row always wins and a repeat 'auto'
 * row is a no-op. Returns whether a row was inserted by this call.
 */
export async function recordSkippedTurn(
  db: Db,
  input: RecordSkippedTurnInput,
  now: number,
): Promise<boolean> {
  const result = await db
    .insert(skippedTurns)
    .values({
      weekStart: input.weekStart,
      userId: input.userId,
      kind: input.kind,
      recordedAt: now,
    })
    .onConflictDoNothing();
  return Number(result.changes) > 0;
}

export async function listRecentSkippedTurns(
  db: Db,
  limit = 50,
): Promise<Array<SkippedTurn & { username: string; displayName: string }>> {
  return db
    .select({
      id: skippedTurns.id,
      weekStart: skippedTurns.weekStart,
      userId: skippedTurns.userId,
      kind: skippedTurns.kind,
      recordedAt: skippedTurns.recordedAt,
      username: users.username,
      displayName: users.displayName,
    })
    .from(skippedTurns)
    .innerJoin(users, eq(skippedTurns.userId, users.id))
    .orderBy(desc(skippedTurns.weekStart))
    .limit(limit);
}

/** All skip rows for one week (admin skips already covered by T07 read this). */
export async function listSkippedTurnsForWeek(db: Db, weekStart: string): Promise<SkippedTurn[]> {
  return db.select().from(skippedTurns).where(eq(skippedTurns.weekStart, weekStart));
}
