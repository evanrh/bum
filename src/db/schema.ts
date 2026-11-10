import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

/**
 * Canonical data model — see plans/README.md.
 *
 * Timestamps are INTEGER unix epoch milliseconds; week identifiers are
 * TEXT ISO YYYY-MM-DD dates; booleans are INTEGER 0/1.
 */

export const settings = sqliteTable(
  'settings',
  {
    id: integer('id').primaryKey(), // singleton row: 1 only
    groupName: text('group_name').notNull().default('Bum'),
    /** bcrypt hash of the signup join code — plaintext is never stored. */
    joinCodeHash: text('join_code_hash').notNull(),
    joiningEnabled: integer('joining_enabled', { mode: 'boolean' })
      .notNull()
      .default(true),
    /** ISO date; start of week 0 (normalized to a week start on write/read). */
    rotationEpoch: text('rotation_epoch').notNull(),
    /** 0 = Sunday … 6 = Saturday. */
    weekStartDay: integer('week_start_day').notNull().default(1),
    weekStartHour: integer('week_start_hour').notNull().default(0),
    /** IANA time zone name, e.g. 'America/New_York'. */
    timezone: text('timezone').notNull().default('UTC'),
    /** Bumped by +1 per admin skip (plans/README.md "Rotation semantics"). */
    rotationOffset: integer('rotation_offset').notNull().default(0),
    /** ISO date checkpoint for the T05 reconciliation job. */
    lastReconciledWeek: text('last_reconciled_week'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check('settings_id_singleton', sql`${t.id} = 1`),
    check('settings_week_start_day_range', sql`${t.weekStartDay} BETWEEN 0 AND 6`),
    check('settings_week_start_hour_range', sql`${t.weekStartHour} BETWEEN 0 AND 23`),
    check('settings_joining_enabled_bool', sql`${t.joiningEnabled} IN (0, 1)`),
  ],
);

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 3-32 chars [A-Za-z0-9_-]; uniqueness is case-insensitive (lower()). */
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    /** Soft "deletion": history is kept, login is blocked. */
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    /** Join order (max+1); admins can reorder actives. */
    rotationOrder: integer('rotation_order').notNull(),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [
    uniqueIndex('users_username_unique').on(
      // expression index: SQLite's lower() is ASCII-only, and the username
      // charset [A-Za-z0-9_-] is ASCII — so this is exact case-insensitivity.
      sql`lower(${t.username})`,
    ),
    check('users_is_admin_bool', sql`${t.isAdmin} IN (0, 1)`),
    check('users_is_active_bool', sql`${t.isActive} IN (0, 1)`),
  ],
);

export const albums = sqliteTable(
  'albums',
  {
    /** Internal unique id: uuid v4 (crypto.randomUUID). */
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    artist: text('artist').notNull(),
    year: integer('year'),
    submittedBy: integer('submitted_by')
      .notNull()
      .references(() => users.id),
    submittedAt: integer('submitted_at').notNull(),
    /** One album per week, max — enforced by UNIQUE. */
    weekStart: text('week_start').notNull().unique(),
    spotifyId: text('spotify_id'),
    youtubeId: text('youtube_id'),
    coverUrl: text('cover_url'),
    note: text('note'),
  },
  (t) => [index('albums_submitted_by_idx').on(t.submittedBy)],
);

export const ratings = sqliteTable(
  'ratings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** Half-stars × 2 → integer 1..10. */
    score: integer('score').notNull(),
    comment: text('comment'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    unique('ratings_album_user').on(t.albumId, t.userId),
    check('ratings_score_range', sql`${t.score} BETWEEN 1 AND 10`),
  ],
);

export const skippedTurns = sqliteTable(
  'skipped_turns',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    weekStart: text('week_start').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** 'auto' = missed a full week (T05 job); 'admin' = mid-week admin skip (T07). */
    kind: text('kind').notNull(),
    recordedAt: integer('recorded_at').notNull(),
  },
  (t) => [
    unique('skipped_turns_week_user').on(t.weekStart, t.userId),
    check('skipped_turns_kind', sql`${t.kind} IN ('auto', 'admin')`),
  ],
);

export type Settings = InferSelectModel<typeof settings>;
export type SettingsInsert = InferInsertModel<typeof settings>;
export type User = InferSelectModel<typeof users>;
export type UserInsert = InferInsertModel<typeof users>;
export type Album = InferSelectModel<typeof albums>;
export type AlbumInsert = InferInsertModel<typeof albums>;
export type Rating = InferSelectModel<typeof ratings>;
export type RatingInsert = InferInsertModel<typeof ratings>;
export type SkippedTurn = InferSelectModel<typeof skippedTurns>;
export type SkippedTurnInsert = InferInsertModel<typeof skippedTurns>;
