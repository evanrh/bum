import { eq } from 'drizzle-orm';

import { getSettings, setLastRotatedWeek } from '../db/repos/settings.ts';
import type { Db } from '../db/index.ts';
import { auditLog, settings } from '../db/schema.ts';
import { autoSubmitBacklogHead } from '../lib/backlog.ts';
import { addWeeksISO, parseQueue, pendingAdvances, rotateQueue, weekId } from '../lib/rotation.ts';

export type AdvanceOptions = { now?: Date; log?: (message: string) => void };

/**
 * Issue #18: a member's turn just "came up" — use their backlog head if
 * they auto-queue. Never throws; guarded against taken weeks internally.
 */
async function fillFromBacklog(db: Db, week: string, opts: { now: number; log: (message: string) => void }): Promise<void> {
  const [row] = await db.select({ rotation: settings.rotation }).from(settings).all();
  const queue = parseQueue(row.rotation);
  await autoSubmitBacklogHead(db, queue[0] ?? null, week, { now: opts.now, log: opts.log });
}

/**
 * Weekly queue advance: pop the current head off and append it at the back —
 * once per elapsed calendar week since the checkpoint (self-healing: a
 * 3-week outage replays 3 advances; the next run is a no-op). Null
 * checkpoint = bootstrap: set it to the current week and rotate nothing
 * (the admin-defined queue order starts as-is). Every advance writes an
 * audit row (actor null = system). Idempotent per plans/T05-jobs.md.
 */
export async function advanceRotation(db: Db, opts: AdvanceOptions = {}): Promise<void> {
  const now = (opts.now ?? new Date()).getTime();
  const log = opts.log ?? (() => {});
  const currentWeek = weekId(new Date(now));

  const current = await getSettings(db, now);
  const last = current.lastRotatedWeek;

  if (last === null) {
    // Bootstrap: the admin-defined order starts as-is; don't touch the queue.
    await setLastRotatedWeek(db, currentWeek, now);
    log(`rotation bootstrap: checkpoint set to ${currentWeek} — no advance`);
    // The head's turn starts now — issue #18: use their backlog if queued.
    await fillFromBacklog(db, currentWeek, { now, log });
    return;
  }

  const pending = pendingAdvances(last, currentWeek);
  let advanced = 0;

  for (let i = 1; i <= pending; i++) {
    const week = addWeeksISO(last, i);
    let moved: number | null = null;
    // One transaction per week: the checkpoint advances only for completed
    // weeks — a crash mid-loop leaves it where it was.
    db.transaction((tx) => {
      const [row] = tx.select({ rotation: settings.rotation }).from(settings).all();
      const result = rotateQueue(parseQueue(row.rotation));
      moved = result.moved;

      tx.update(settings)
        .set({ rotation: JSON.stringify(result.queue), lastRotatedWeek: week, updatedAt: now })
        .where(eq(settings.id, 1))
        .run();

      if (result.moved !== null) {
        tx.insert(auditLog)
          .values({
            actorUserId: null,
            action: 'queue.advance',
            detail: `advanced the rotation for week ${week}: ${result.moved} moved to the back`,
            createdAt: now,
          })
          .run();
      }
    });
    if (moved !== null) advanced += 1;
  }

  if (advanced > 0) {
    // The new head's turn came up — issue #18: use their backlog if queued.
    // Only for the current week: skipped-outage weeks stay empty by design.
    await fillFromBacklog(db, currentWeek, { now, log });
  }

  log(`rotation advance: ${advanced} week(s) advanced — now at ${currentWeek}`);
}
