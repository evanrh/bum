import { z } from 'zod';

import type { Db } from '../db/index.ts';
import * as albumsRepo from '../db/repos/albums.ts';
import * as auditRepo from '../db/repos/audit.ts';
import * as backlogRepo from '../db/repos/backlog.ts';
import * as usersRepo from '../db/repos/users.ts';
import type { BacklogItem, User } from '../db/schema.ts';
import { albumInputSchema } from './albums.ts';
import { parseSpotifyAlbum, parseYouTubeVideo, resolveCoverUrl } from './external.ts';
import { ApiError } from './errors.ts';
import { requireActiveUser } from './permissions.ts';
import { or400 } from './validate.ts';

/**
 * The member album backlog (issue #18): members queue albums ahead of their
 * weeks. When their turn comes up (weekly advance, or an admin override that
 * hands them the week), the first queued item becomes the week's
 * submission if auto-queueing is enabled for them. Same validation and
 * cover resolution as /submit; anything failed/absent is non-fatal.
 */

export type AddBacklogOptions = { now?: number; fetch?: typeof fetch };

/** Add to the back of the member's own queue. */
export async function addBacklogItem(
  user: User,
  db: Db,
  input: unknown,
  opts: AddBacklogOptions = {},
): Promise<BacklogItem> {
  const active = requireActiveUser({ user });
  const parsed = or400(albumInputSchema, input);
  const now = opts.now ?? Date.now();
  const fetchImpl = opts.fetch ?? fetch.bind(globalThis);

  const spotifyId = parsed.spotify_url?.trim() ? parseSpotifyAlbum(parsed.spotify_url) : undefined;
  const youtubeId = parsed.youtube_url?.trim() ? parseYouTubeVideo(parsed.youtube_url) : undefined;
  const coverUrl = await resolveCoverUrl({ spotifyId, youtubeId }, fetchImpl);

  return backlogRepo.appendBacklogItem(
    db,
    {
      id: crypto.randomUUID(),
      userId: active.id,
      title: parsed.title,
      artist: parsed.artist,
      year: parsed.year ?? null,
      spotifyId: spotifyId ?? null,
      youtubeId: youtubeId ?? null,
      coverUrl,
      note: parsed.note ?? null,
    },
    now,
  );
}

const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });

/** Reorder the member's own queue — the submitted list must be exact. */
export async function reorderBacklog(user: User, db: Db, input: unknown, now: number = Date.now()): Promise<BacklogItem[]> {
  const active = requireActiveUser({ user });
  const parsed = or400(reorderSchema, input);

  const current = await backlogRepo.listBacklogItems(db, active.id);
  const byId = new Map(current.map((item) => [item.id, item]));
  const valid =
    parsed.ids.length === current.length &&
    parsed.ids.every((id) => byId.has(id)) &&
    new Set(parsed.ids).size === parsed.ids.length;
  if (!valid) throw new ApiError(400, 'order must list exactly your backlog items, no duplicates');

  await backlogRepo.repositionBacklog(
    db,
    active.id,
    parsed.ids.map((id, index) => ({ id, position: index + 1 })),
    now,
  );
  return backlogRepo.listBacklogItems(db, active.id);
}

/** Remove one of the member's own queued items. */
export async function removeBacklogItem(user: User, db: Db, id: string): Promise<boolean> {
  const active = requireActiveUser({ user });
  const removed = await backlogRepo.removeBacklogItem(db, id, active.id);
  if (!removed) throw new ApiError(404, 'backlog item not found');
  return removed;
}

const toggleSchema = z.object({ enabled: z.boolean() });

/** The per-member auto-queue toggle (default on). */
export async function setAutoQueue(user: User, db: Db, input: unknown): Promise<User> {
  const active = requireActiveUser({ user });
  const parsed = or400(toggleSchema, input);
  return usersRepo.setAutoBacklog(db, active.id, parsed.enabled);
}

export type AutoSubmitOptions = { now?: number; log?: (message: string) => void };

/**
 * If the picker queued albums and auto-queueing is on for them, their head
 * item becomes the submitted album for the given week (the item leaves the
 * backlog). Never throws, runs as the system (actor null in the audit log)
 * and reports what happened so callers can log it. Returns what was used.
 */
export async function autoSubmitBacklogHead(
  db: Db,
  pickerId: number | null,
  week: string,
  opts: AutoSubmitOptions = {},
): Promise<{ submitted: boolean; detail?: string }> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now();
  if (pickerId === null) return { submitted: false };

  const picker = await usersRepo.getUserById(db, pickerId);
  if (!picker || !picker.isActive || !picker.autoBacklog) return { submitted: false };

  const head = await backlogRepo.backlogHead(db, pickerId);
  if (!head) return { submitted: false };

  if (await albumsRepo.getAlbumByWeekStart(db, week)) {
    // Defensive: the week is already taken (manual submit, or a re-run) —
    // the queued item stays pending for a later week.
    log(`[backlog] week ${week} already has an album; ${picker.displayName}'s queue keeps its head`);
    return { submitted: false };
  }

  const result = await albumsRepo.insertAlbum(db, {
    title: head.title,
    artist: head.artist,
    year: head.year,
    submittedBy: pickerId,
    submittedAt: now,
    weekStart: week,
    spotifyId: head.spotifyId,
    youtubeId: head.youtubeId,
    coverUrl: head.coverUrl,
    note: head.note,
  });
  if (!result.ok) {
    log(`[backlog] auto-submit for ${picker.displayName} hit a conflict: ${result.reason}`);
    return { submitted: false };
  }
  await backlogRepo.removeBacklogItem(db, head.id, pickerId);
  const detail = `${picker.displayName}'s queued "${head.title}" auto-submitted for week ${week}`;
  await auditRepo.recordAudit(db, { actorUserId: null, action: 'backlog.auto_submit', detail }, now);
  log(`[backlog] ${detail}`);
  return { submitted: true, detail };
}
