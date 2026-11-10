import { desc, eq } from 'drizzle-orm';

import { auditLog, users, type AuditLog } from '../schema.ts';
import type { Db } from '../index.ts';

export type RecordAuditInput = {
  /** The acting user, or null for system actions (the jobs process). */
  actorUserId: number | null;
  /** Machine tag, e.g. 'queue.advance' | 'queue.override' | 'queue.remove'. */
  action: string;
  /** Short human-readable summary (optional). */
  detail?: string | null;
};

export type AuditEntry = AuditLog & {
  actorUsername: string | null;
  actorDisplayName: string | null;
};

/** Append one audit row. Callers own the transaction when atomicity matters. */
export async function recordAudit(db: Db, input: RecordAuditInput, now: number): Promise<AuditLog> {
  const [row] = await db
    .insert(auditLog)
    .values({
      actorUserId: input.actorUserId,
      action: input.action,
      detail: input.detail ?? null,
      createdAt: now,
    })
    .returning();
  return row;
}

/**
 * Newest-first audit history. A null actor (system actions) keeps null name
 * columns — the API/upstream renders "system".
 */
export async function listRecentAudit(db: Db, limit = 50): Promise<AuditEntry[]> {
  return db
    .select({
      id: auditLog.id,
      actorUserId: auditLog.actorUserId,
      action: auditLog.action,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
      actorUsername: users.username,
      actorDisplayName: users.displayName,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorUserId, users.id))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit);
}
