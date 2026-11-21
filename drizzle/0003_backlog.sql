-- Issue #18: member backlogs + the per-user auto-queue toggle.
-- Hand-adjusted (same reason as migration 0002): the runtime migrator wraps
-- each migration in one transaction, so the table-recreate form of the users
-- change would fail (its PRAGMA foreign_keys=OFF is a no-op inside the
-- transaction and users is an FK parent). The users change is written as a
-- plain ALTER ADD COLUMN instead, and the new backlog table is a pure CREATE.
CREATE TABLE `backlog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`year` integer,
	`spotify_id` text,
	`youtube_id` text,
	`cover_url` text,
	`note` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "backlog_year_range" CHECK("backlog_items"."year" IS NULL OR ("backlog_items"."year" BETWEEN 1900 AND 2100))
);
--> statement-breakpoint
CREATE INDEX `backlog_user_position_idx` ON `backlog_items` (`user_id`,`position`);--> statement-breakpoint
ALTER TABLE `users` ADD `auto_backlog` integer DEFAULT true NOT NULL CONSTRAINT "users_auto_backlog_bool" CHECK(`auto_backlog` IN (0, 1));
