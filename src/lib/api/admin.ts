import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';

import type { Db } from '../../db/index.ts';
import { albums, auditLog, ratings, settings, users } from '../../db/schema.ts';
import * as albumsRepo from '../../db/repos/albums.ts';
import * as auditRepo from '../../db/repos/audit.ts';
import type { AuditEntry } from '../../db/repos/audit.ts';
import * as settingsRepo from '../../db/repos/settings.ts';
import * as usersRepo from '../../db/repos/users.ts';
import type { User } from '../../db/schema.ts';
import { hashPassword } from '../auth.ts';
import { autoSubmitBacklogHead } from '../backlog.ts';
import { sessionStore } from '../sessions.ts';
import { ApiError, jsonError } from '../errors.ts';
import { requireAdmin } from '../permissions.ts';
import { currentTurn } from '../rotation.ts';
import { or400 } from '../validate.ts';
import { isFormPost, redirect } from './http.ts';

/**
 * Admin surface — everything guarded by requireAdmin (401/403 JSON, per
 * plans/README.md). Queue mutations keep their audit rows and the
 * membership invariants inside the same transaction: deactivation removes
 * from the queue, activation appends at the back, reset-password
 * invalidates the target's sessions.
 */

type AdminContext = { db: Db; user: User | null };

const safeUser = (user: User): Record<string, unknown> => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  isAdmin: user.isAdmin,
  isOriginalAdmin: user.isOriginalAdmin,
  isActive: user.isActive,
  joinedAt: user.joinedAt,
});

const countStar = () => sql<number>`count(*)`;

async function countBy(db: Db, kind: 'submissions' | 'ratings'): Promise<Map<number, number>> {
  const table = kind === 'submissions' ? albums : ratings;
  const column = kind === 'submissions' ? albums.submittedBy : ratings.userId;
  const rows = await db
    .select({ userId: column, count: countStar() })
    .from(table)
    .groupBy(column);
  return new Map(rows.map((row) => [row.userId, Number(row.count)]));
}

function parseQueueJson(json: string): number[] {
  try {
    const parsed: unknown = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : [];
  } catch {
    return [];
  }
}

function respondUser(user: User): Response {
  return new Response(JSON.stringify({ user: safeUser(user) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export type RosterEntry = User & {
  submissionCount: number;
  ratingCount: number;
  queuePosition: number | null;
};

/** Roster assembly shared by the GET handler and the /admin page. */
export async function buildRoster(db: Db): Promise<RosterEntry[]> {
  const users = await usersRepo.listAllUsers(db);
  const submissionCounts = await countBy(db, 'submissions');
  const ratingCounts = await countBy(db, 'ratings');
  const queue = await settingsRepo.getRotation(db);
  const positionOf = new Map(queue.map((id, index) => [id, index + 1]));
  return users.map((user) => ({
    ...user,
    submissionCount: submissionCounts.get(user.id) ?? 0,
    ratingCount: ratingCounts.get(user.id) ?? 0,
    queuePosition: positionOf.get(user.id) ?? null,
  }));
}

/** GET /api/admin/users — roster + counts + queue positions. */
export async function listUsers(db: Db, admin: User | null): Promise<Response> {
  try {
    requireAdmin({ user: admin });
    return new Response(JSON.stringify({ users: await buildRoster(db) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

const actionSchema = z.object({
  action: z.enum(['promote', 'demote', 'activate', 'deactivate', 'reset_password']),
  password: z.string().min(8, 'password must be at least 8 characters').max(128).optional(),
});

/** POST /api/admin/users/{id} — the five member actions. */
export async function userAction(
  db: Db,
  admin: User | null,
  targetId: number,
  body: unknown,
  now: number = Date.now(),
): Promise<Response> {
  try {
    const acting = requireAdmin({ user: admin });
    const input = or400(actionSchema, body);
    const target = await usersRepo.getUserById(db, targetId);
    if (!target) throw new ApiError(404, 'user not found');

    if (input.action === 'promote') {
      if (target.isAdmin) throw new ApiError(409, 'user is already an admin');
      const updated = await usersRepo.setUserAdmin(db, target.id, true);
      return respondUser(updated);
    }
    if (input.action === 'demote') {
      if (!target.isAdmin) throw new ApiError(409, 'user is not an admin');
      // Issue #15: the first user ever created is the permanent original
      // admin — no actor (other admin or themselves) may remove it.
      if (target.isOriginalAdmin) throw new ApiError(409, 'the original admin cannot be demoted');
      if ((await usersRepo.listAllUsers(db)).filter((candidate) => candidate.isAdmin).length <= 1) {
        throw new ApiError(409, 'you cannot demote the last admin');
      }
      const updated = await usersRepo.setUserAdmin(db, target.id, false);
      return respondUser(updated);
    }
    if (input.action === 'deactivate') {
      if (!target.isActive) throw new ApiError(409, 'user is already deactivated');
      let updated: User | undefined;
      db.transaction((tx) => {
        const rows = tx
          .update(users)
          .set({ isActive: false })
          .where(eq(users.id, target.id))
          .returning()
          .all();
        updated = rows[0];
        const [row] = tx.select({ rotation: settings.rotation }).from(settings).all();
        const queue = parseQueueJson(row.rotation);
        if (queue.includes(target.id)) {
          // Queue invariant: deactivation removes the member wherever they sit.
          tx.update(settings)
            .set({ rotation: JSON.stringify(queue.filter((id) => id !== target.id)), updatedAt: now })
            .where(eq(settings.id, 1))
            .run();
          tx.insert(auditLog)
            .values({
              actorUserId: acting.id,
              action: 'queue.remove',
              detail: `${target.displayName} deactivated — removed from the rotation`,
              createdAt: now,
            })
            .run();
        }
      });
      if (!updated) throw new ApiError(404, 'user not found');
      sessionStore.dropUser(target.id); // loses login immediately
      return respondUser(updated);
    }
    if (input.action === 'activate') {
      if (target.isActive) throw new ApiError(409, 'user is already active');
      let updated: User | undefined;
      db.transaction((tx) => {
        const rows = tx
          .update(users)
          .set({ isActive: true })
          .where(eq(users.id, target.id))
          .returning()
          .all();
        updated = rows[0];
        const [row] = tx.select({ rotation: settings.rotation }).from(settings).all();
        const queue = parseQueueJson(row.rotation);
        if (!queue.includes(target.id)) {
          // Reactivates at the BACK of the rotation.
          tx.update(settings)
            .set({ rotation: JSON.stringify([...queue, target.id]), updatedAt: now })
            .where(eq(settings.id, 1))
            .run();
          tx.insert(auditLog)
            .values({
              actorUserId: acting.id,
              action: 'queue.append',
              detail: `${target.displayName} reactivated — joins the back of the rotation`,
              createdAt: now,
            })
            .run();
        }
      });
      if (!updated) throw new ApiError(404, 'user not found');
      return respondUser(updated);
    }
    // reset_password
    if (!input.password) throw new ApiError(400, 'password is required for reset_password');
    const hash = await hashPassword(input.password);
    const updated = await usersRepo.setUserPassword(db, target.id, hash);
    sessionStore.dropUser(target.id); // force re-login everywhere
    return respondUser(updated);
  } catch (error) {
    return jsonError(error);
  }
}

const orderSchema = z.object({ queue: z.array(z.number().int()).min(1) });

/** POST /api/admin/rotation/order — the whole queue, exactly the active set. */
export async function setOrder(db: Db, admin: User | null, body: unknown, now: number = Date.now()): Promise<Response> {
  try {
    const acting = requireAdmin({ user: admin });
    const input = or400(orderSchema, body);
    const active = await usersRepo.listActiveUsers(db);
    const wanted = new Set(input.queue);
    const valid =
      wanted.size === input.queue.length &&
      input.queue.every((id) => active.some((member) => member.id === id)) &&
      active.every((member) => wanted.has(member.id));
    if (!valid) throw new ApiError(400, 'queue must contain exactly the active members, no duplicates');

    await settingsRepo.setRotation(db, input.queue, now);
    await auditRepo.recordAudit(
      db,
      { actorUserId: acting.id, action: 'queue.order', detail: 'rotation order rewritten' },
      now,
    );
    return new Response(JSON.stringify({ queue: input.queue }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** POST /api/admin/rotation/settings — group name only (schedule is fixed). */
export async function updateGroupName(
  db: Db,
  admin: User | null,
  body: unknown,
  now: number = Date.now(),
): Promise<Response> {
  try {
    requireAdmin({ user: admin });
    const input = or400(z.object({ group_name: z.string().min(1).max(100).optional() }), body);
    const updated = await settingsRepo.updateSettings(db, { groupName: input.group_name }, now);
    return new Response(JSON.stringify({ groupName: updated.groupName }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/admin/rotation/skip — one manual pop/push, always allowed,
 * logged as queue.override inside the mutation's transaction (audit-first).
 * If the outgoing picker had submitted this week the album stays and the
 * response carries a warning.
 */
export async function skipCurrent(db: Db, admin: User | null, now: number = Date.now()): Promise<Response> {
  try {
    const acting = requireAdmin({ user: admin });
    const current = await settingsRepo.getSettings(db, now);
    const queue = parseQueueJson(current.rotation);
    if (queue.length === 0) throw new ApiError(409, 'nothing to skip');
    const outgoingId = queue[0];
    const outgoing = await usersRepo.getUserById(db, outgoingId);
    const week = currentTurn({ rotation: current.rotation }, new Date(now)).week;
    const submittedAlbum = await albumsRepo.getAlbumByWeekStart(db, week);

    await db.transaction((tx) => {
      tx.insert(auditLog)
        .values({
          actorUserId: acting.id,
          action: 'queue.override',
          detail: `${acting.displayName} skipped ${outgoing?.displayName ?? outgoingId} for week ${week}`,
          createdAt: now,
        })
        .run();
      const rotated = [...queue.slice(1), queue[0]];
      tx.update(settings)
        .set({ rotation: JSON.stringify(rotated), updatedAt: now })
        .where(eq(settings.id, 1))
        .run();
    });

    const nextQueue = await settingsRepo.getRotation(db);
    const nextPicker = nextQueue[0] !== undefined ? await usersRepo.getUserById(db, nextQueue[0]) : undefined;
    // The new head's turn came up — issue #18: their backlog head may be used.
    // Guarded internally (taken weeks are left alone).
    await autoSubmitBacklogHead(db, nextQueue[0] ?? null, week, { now });
    return new Response(
      JSON.stringify({
        queue: nextQueue,
        moved: { id: outgoingId, displayName: outgoing?.displayName ?? String(outgoingId) },
        picker: nextPicker ? { id: nextPicker.id, displayName: nextPicker.displayName } : null,
        ...(submittedAlbum
          ? { warning: `${outgoing?.displayName ?? 'the picker'} submitted an album this week; it was not deleted` }
          : {}),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

const selectSchema = z.object({ user_id: z.number().int().positive() });

/**
 * POST /api/admin/rotation/select — arbitrary override (issue #17): name any
 * member in the rotation as this week's picker. The chosen member moves to
 * the head; every other member keeps their relative order (nothing is
 * pushed to the back, unlike the pop/push skip). Logged as `queue.override`
 * with the acting admin inside the same transaction.
 */
export async function selectPicker(
  db: Db,
  admin: User | null,
  body: unknown,
  now: number = Date.now(),
): Promise<Response> {
  try {
    const acting = requireAdmin({ user: admin });
    const input = or400(selectSchema, body);
    const current = await settingsRepo.getSettings(db, now);
    const queue = parseQueueJson(current.rotation);
    if (queue.length === 0) throw new ApiError(409, 'nothing to skip');
    const index = queue.indexOf(input.user_id);
    if (index < 0) throw new ApiError(409, 'that member is not in the rotation');
    const target = await usersRepo.getUserById(db, input.user_id);
    if (!target) throw new ApiError(404, 'user not found');
    const previousId = queue[0];
    const previous = await usersRepo.getUserById(db, previousId);
    const week = currentTurn({ rotation: current.rotation }, new Date(now)).week;
    // Issue #17 (owner feedback): the override ROTATES the queue circularly
    // until the named member is at the head — [a,b,c,d] + select c →
    // [c,d,a,b]: everyone before them goes to the back, in order. This
    // composes with the weekly pop/push advance, so a full cycle restores
    // the original order exactly. It is NOT a remove+insert.
    const rotated = index === 0 ? queue : [...queue.slice(index), ...queue.slice(0, index)];

    await db.transaction((tx) => {
      tx.insert(auditLog)
        .values({
          actorUserId: acting.id,
          action: 'queue.override',
          detail:
            index === 0
              ? `${acting.displayName} confirmed ${target.displayName} as the picker for week ${week}`
              : `${acting.displayName} overrode the rotation: ${target.displayName} now picks for week ${week}`,
          createdAt: now,
        })
        .run();
      if (index !== 0) {
        tx.update(settings)
          .set({ rotation: JSON.stringify(rotated), updatedAt: now })
          .where(eq(settings.id, 1))
          .run();
      }
    });

    const submittedAlbum = await albumsRepo.getAlbumByWeekStart(db, week);
    // The named member's turn came up — issue #18: their queue may fill the
    // week. Guarded internally (taken weeks are left alone).
    await autoSubmitBacklogHead(db, target.id, week, { now });
    let warning: string | undefined;
    if (submittedAlbum) {
      const submitter = await usersRepo.getUserById(db, submittedAlbum.submittedBy);
      warning = `${submitter?.displayName ?? 'someone'} already submitted an album for this week; it was not deleted`;
    }
    return new Response(
      JSON.stringify({
        queue: rotated,
        moved: { id: previousId, displayName: previous?.displayName ?? String(previousId) },
        picker: { id: target.id, displayName: target.displayName },
        ...(warning ? { warning } : {}),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/admin/rotation/backlog-fill (issue #44) — run the same trigger
 * the weekly advance runs, for the member who is already the picker, this
 * week. The queue and checkpoint are untouched; every no-op answers
 * distinctly (409) so the lever stays actionable instead of guessing.
 */
export async function triggerBacklogFill(db: Db, admin: User | null, now: number = Date.now()): Promise<Response> {
  try {
    const acting = requireAdmin({ user: admin });
    const current = await settingsRepo.getSettings(db, now);
    const queue = parseQueueJson(current.rotation);
    if (queue.length === 0) throw new ApiError(409, 'nothing to fill — the rotation is empty');
    const pickerId = queue[0];
    const picker = await usersRepo.getUserById(db, pickerId);
    if (!picker || !picker.isActive) throw new ApiError(409, 'the current picker is inactive');

    const week = currentTurn({ rotation: current.rotation }, new Date(now)).week;
    // The function is the authority: it re-checks everything and runs as the
    // system (its own backlog.auto_submit audit row). Failures here can only
    // be races — still answered with a reason, never a bare 500.
    const result = await autoSubmitBacklogHead(db, picker.id, week, { now });
    if (!result.submitted) {
      if (result.reason === 'no_queued_items') {
        throw new ApiError(409, `${picker.displayName} has nothing queued in their backlog`);
      }
      if (result.reason === 'auto_queue_off') {
        throw new ApiError(409, `auto-queue is off for ${picker.displayName} — turn it on or submit manually`);
      }
      if (result.reason === 'week_taken') {
        throw new ApiError(409, `week ${week} already has an album — nothing was changed`);
      }
      throw new ApiError(409, `nothing was filled (${result.reason})`);
    }

    // On top of the system backlog.auto_submit row: the audit page should
    // show who pulled the lever, not only that it was pulled.
    await auditRepo.recordAudit(
      db,
      { actorUserId: acting.id, action: 'backlog.manual_trigger', detail: result.detail },
      now,
    );
    return new Response(
      JSON.stringify({
        submitted: true,
        detail: result.detail,
        picker: { id: picker.id, displayName: picker.displayName },
        week,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

/** POST /api/admin/join-code — the plaintext is shown exactly once. */
export async function rotateJoinCode(db: Db, admin: User | null, now: number = Date.now()): Promise<Response> {
  try {
    requireAdmin({ user: admin });
    const joinCode = await settingsRepo.rotateJoinCode(db, now);
    return new Response(JSON.stringify({ join_code: joinCode }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

const joiningSchema = z.object({ enabled: z.boolean() });

/** POST /api/admin/joining — signup gate toggle. */
export async function toggleJoining(db: Db, admin: User | null, body: unknown, now: number = Date.now()): Promise<Response> {
  try {
    requireAdmin({ user: admin });
    const input = or400(joiningSchema, body);
    const updated = await settingsRepo.updateSettings(db, { joiningEnabled: input.enabled }, now);
    return new Response(JSON.stringify({ joiningEnabled: updated.joiningEnabled }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** GET /api/admin/audit — recent audit rows (limit 1..200, default 50). */
export async function listAudit(db: Db, admin: User | null, limit: number = 50): Promise<Response> {
  try {
    requireAdmin({ user: admin });
    const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? limit : 50, 1), 200);
    const entries: AuditEntry[] = await auditRepo.listRecentAudit(db, safeLimit);
    return new Response(JSON.stringify({ entries }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/albums/{id}/delete — admin-only album removal (ratings
 * cascade). Form posts redirect back to /albums; JSON clients get 204.
 */
export async function deleteAlbum(
  request: Request,
  db: Db,
  admin: User | null,
  albumId: string,
  now: number = Date.now(),
): Promise<Response> {
  try {
    const acting = requireAdmin({ user: admin });
    const album = await albumsRepo.getAlbumById(db, albumId);
    if (!album) throw new ApiError(404, 'album not found');
    await albumsRepo.deleteAlbum(db, albumId); // ratings cascade (FK)
    await auditRepo.recordAudit(db, { actorUserId: acting.id, action: 'album.delete', detail: `deleted "${album.title}" (week ${album.weekStart})` }, now);
    if (isFormPost(request)) return redirect('/albums');
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(error);
  }
}
