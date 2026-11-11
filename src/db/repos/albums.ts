import { asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { albums, ratings, type Album } from '../schema.ts';
import type { Db } from '../index.ts';

export type CreateAlbumInput = {
  id?: string;
  title: string;
  artist: string;
  year?: number | null;
  submittedBy: number;
  submittedAt: number;
  weekStart: string;
  spotifyId?: string | null;
  youtubeId?: string | null;
  coverUrl?: string | null;
  note?: string | null;
};

export type InsertAlbumResult =
  | { ok: true; album: Album }
  | { ok: false; reason: 'WEEK_TAKEN' | 'UNEXPECTED'; detail?: string };

const uniqueErrorCode = 'SQLITE_CONSTRAINT_UNIQUE';

/**
 * Insert an album. `week_start` is UNIQUE (one album per week), a conflict
 * is surfaced as the typed marker WEEK_TAKEN instead of a raw error.
 */
export async function insertAlbum(db: Db, input: CreateAlbumInput): Promise<InsertAlbumResult> {
  try {
    const [album] = await db
      .insert(albums)
      .values({
        id: input.id ?? crypto.randomUUID(),
        title: input.title,
        artist: input.artist,
        year: input.year ?? null,
        submittedBy: input.submittedBy,
        submittedAt: input.submittedAt,
        weekStart: input.weekStart,
        spotifyId: input.spotifyId ?? null,
        youtubeId: input.youtubeId ?? null,
        coverUrl: input.coverUrl ?? null,
        note: input.note ?? null,
      })
      .returning();
    return { ok: true, album };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === uniqueErrorCode) {
      return { ok: false, reason: 'WEEK_TAKEN' };
    }
    return { ok: false, reason: 'UNEXPECTED', detail: String(error) };
  }
}

export async function getAlbumById(db: Db, id: string): Promise<Album | undefined> {
  const [album] = await db.select().from(albums).where(eq(albums.id, id)).limit(1);
  return album;
}

export async function getAlbumByWeekStart(db: Db, weekStart: string): Promise<Album | undefined> {
  const [album] = await db.select().from(albums).where(eq(albums.weekStart, weekStart)).limit(1);
  return album;
}

export type UpdateAlbumFields = Partial<
  Pick<Album, 'title' | 'artist' | 'year' | 'note' | 'spotifyId' | 'youtubeId' | 'coverUrl'>
>;

export async function updateAlbum(
  db: Db,
  id: string,
  patch: UpdateAlbumFields,
): Promise<Album | undefined> {
  const set: Record<string, unknown> = {};
  for (const key of ['title', 'artist', 'year', 'note', 'spotifyId', 'youtubeId', 'coverUrl'] as const) {
    if (patch[key] !== undefined) set[key] = patch[key];
  }
  if (Object.keys(set).length === 0) return getAlbumById(db, id);
  const [album] = await db.update(albums).set(set).where(eq(albums.id, id)).returning();
  return album;
}

export async function deleteAlbum(db: Db, id: string): Promise<boolean> {
  const result = await db.delete(albums).where(eq(albums.id, id));
  return Number(result.changes) > 0;
}

const albumColumns = {
  id: albums.id,
  title: albums.title,
  artist: albums.artist,
  year: albums.year,
  submittedBy: albums.submittedBy,
  submittedAt: albums.submittedAt,
  weekStart: albums.weekStart,
  spotifyId: albums.spotifyId,
  youtubeId: albums.youtubeId,
  coverUrl: albums.coverUrl,
  note: albums.note,
};

export type AlbumWithStats = Album & { avgScore: number | null; ratingCount: number };

/** One decimal place, exactly as rendered in the UI. */
const normalizeAvg = (value: unknown): number | null =>
  value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10;

const avgExpr = sql<string | null>`avg(${ratings.score})`;
const cntExpr = sql<number>`count(${ratings.id})`;

type AlbumSqliteAggregateRow = Album & {
  avgScore: string | number | null;
  ratingCount: string | number;
};

export type ListAlbumsOptions = {
  submitterId?: number;
  sort?: 'newest' | 'avg';
  limit?: number;
  offset?: number;
};

/**
 * Album list with rating aggregates. `sort: 'avg'` orders by average score
 * descending (albums without ratings last), ties broken by fewer ratings
 * first, then newest.
 */
export async function listAlbums(
  db: Db,
  opts: ListAlbumsOptions = {},
): Promise<{ items: AlbumWithStats[]; total: number }> {
  const where = opts.submitterId === undefined ? undefined : eq(albums.submittedBy, opts.submitterId);
  const orderBy =
    opts.sort === 'avg'
      ? [desc(avgExpr), asc(cntExpr), desc(albums.submittedAt)]
      : [desc(albums.submittedAt)];

  const rows = (await db
    .select({ ...albumColumns, avgScore: avgExpr, ratingCount: cntExpr })
    .from(albums)
    .leftJoin(ratings, eq(ratings.albumId, albums.id))
    .where(where)
    .groupBy(albums.id)
    .orderBy(...orderBy)
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0)) as AlbumSqliteAggregateRow[];

  const [totalRow] = await db.select({ total: count() }).from(albums).where(where);
  return {
    items: rows.map((r) => ({
      ...r,
      avgScore: normalizeAvg(r.avgScore),
      ratingCount: Number(r.ratingCount),
    })),
    total: Number(totalRow.total),
  };
}

export type AlbumStats = { avgScore: number | null; ratingCount: number };

/**
 * Aggregate stats for specific album ids (leaderboards, page headers).
 * Every id that exists in `albums` gets an entry — unrated albums come
 * back as `{ avgScore: null, ratingCount: 0 }` (page guards must not
 * mistake "no ratings yet" for "missing album"); unknown ids stay absent.
 */
export async function statsForAlbums(db: Db, albumIds: string[]): Promise<Record<string, AlbumStats>> {
  if (albumIds.length === 0) return {};
  const rows = (await db
    .select({ albumId: albums.id, avgScore: avgExpr, ratingCount: cntExpr })
    .from(albums)
    .leftJoin(ratings, eq(ratings.albumId, albums.id))
    .where(inArray(albums.id, albumIds))
    .groupBy(albums.id)) as Array<{
    albumId: string;
    avgScore: string | number | null;
    ratingCount: string | number;
  }>;
  const map: Record<string, AlbumStats> = {};
  for (const row of rows) {
    map[row.albumId] = { avgScore: normalizeAvg(row.avgScore), ratingCount: Number(row.ratingCount) };
  }
  return map;
}
