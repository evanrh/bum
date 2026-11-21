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
    /**
     * The rotation queue: JSON array of user ids. The head (index 0) is the
     * current picker (plans/README.md "Rotation semantics").
     */
    rotation: text('rotation').notNull().default('[]'),
    /** ISO Monday checkpoint: the last week the T05 job advanced past. */
    lastRotatedWeek: text('last_rotated_week'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check('settings_id_singleton', sql`${t.id} = 1`),
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
    /**
     * "Super admin" state (issue #15): the first user ever created. Set at
     * signup (and backfilled from MIN(id) for pre-existing deployments);
     * the demote endpoint rejects any attempt to remove it.
     */
    isOriginalAdmin: integer('is_original_admin', { mode: 'boolean' })
      .notNull()
      .default(false),
    /**
     * Issue #18: when the member's rotation week starts and auto-queueing is
     * on, their first backlog item becomes the week's album automatically.
     * Enabled by default.
     */
    autoBacklog: integer('auto_backlog', { mode: 'boolean' }).notNull().default(true),
    /** Soft "deletion": history is kept, login is blocked. */
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [
    uniqueIndex('users_username_unique').on(
      // expression index: SQLite's lower() is ASCII-only, and the username
      // charset [A-Za-z0-9_-] is ASCII — so this is exact case-insensitivity.
      sql`lower(${t.username})`,
    ),
    check('users_is_admin_bool', sql`${t.isAdmin} IN (0, 1)`),
    check('users_is_original_admin_bool', sql`${t.isOriginalAdmin} IN (0, 1)`),
    check('users_is_active_bool', sql`${t.isActive} IN (0, 1)`),
    check('users_auto_backlog_bool', sql`${t.autoBacklog} IN (0, 1)`),
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

export const backlogItems = sqliteTable(
  'backlog_items',
  {
    /** Internal unique id: uuid v4 (crypto.randomUUID). */
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** 1-200 chars (same limits as albums). */
    title: text('title').notNull(),
    artist: text('artist').notNull(),
    /** Optional, 1900-2100. */
    year: integer('year'),
    /** Parsed from a pasted URL at add time (same as /submit). */
    spotifyId: text('spotify_id'),
    youtubeId: text('youtube_id'),
    /** Best-effort resolved at add time; null → UI placeholder. */
    coverUrl: text('cover_url'),
    /** Optional, ≤ 1000 chars. */
    note: text('note'),
    /** Order within the member's backlog: lower = next to be used. */
    position: integer('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('backlog_user_position_idx').on(t.userId, t.position),
    check('backlog_year_range', sql`${t.year} IS NULL OR (${t.year} BETWEEN 1900 AND 2100)`),
  ],
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

/**
 * Generic audit log — every rotation change (weekly advance, admin override,
 * queue membership changes) lands here. No skip-specific semantics; `action`
 * is a short machine tag, `detail` a human-readable summary.
 */
/**
 * Generic audit log — every rotation change (weekly advance, admin override,
 * queue membership changes) lands here. No skip-specific semantics; `action`
 * is a short machine tag, `detail` a human-readable summary.
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** The acting user, or null for system actions (the jobs process). */
    actorUserId: integer('actor_user_id').references(() => users.id),
    /** Machine tag, e.g. 'queue.advance' | 'queue.override' | 'queue.remove'. */
    action: text('action').notNull(),
    detail: text('detail'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('audit_log_created_at_idx').on(t.createdAt)],
);

export type Settings = InferSelectModel<typeof settings>;
export type SettingsInsert = InferInsertModel<typeof settings>;
export type User = InferSelectModel<typeof users>;
export type UserInsert = InferInsertModel<typeof users>;
export type Album = InferSelectModel<typeof albums>;
export type AlbumInsert = InferInsertModel<typeof albums>;
export type BacklogItem = InferSelectModel<typeof backlogItems>;
export type BacklogItemInsert = InferInsertModel<typeof backlogItems>;
export type Rating = InferSelectModel<typeof ratings>;
export type RatingInsert = InferInsertModel<typeof ratings>;
export type AuditLog = InferSelectModel<typeof auditLog>;
export type AuditLogInsert = InferInsertModel<typeof auditLog>;
