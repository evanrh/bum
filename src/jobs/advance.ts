import { eq } from 'drizzle-orm';

import { getSettings, setLastRotatedWeek } from '../db/repos/settings.ts';
import type { Db } from '../db/index.ts';
import { auditLog, settings } from '../db/schema.ts';
import { addWeeksISO, parseQueue, pendingAdvances, rotateQueue, weekId } from '../lib/rotation.ts';

export type AdvanceOptions = { now?: Date; log?: (message: string) => void };

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

  log(`rotation advance: ${advanced} week(s) advanced — now at ${currentWeek}`);
}
