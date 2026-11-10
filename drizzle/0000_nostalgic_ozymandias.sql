CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`year` integer,
	`submitted_by` integer NOT NULL,
	`submitted_at` integer NOT NULL,
	`week_start` text NOT NULL,
	`spotify_id` text,
	`youtube_id` text,
	`cover_url` text,
	`note` text,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `albums_week_start_unique` ON `albums` (`week_start`);--> statement-breakpoint
CREATE INDEX `albums_submitted_by_idx` ON `albums` (`submitted_by`);--> statement-breakpoint
CREATE TABLE `ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`album_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`score` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ratings_score_range" CHECK("ratings"."score" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ratings_album_user` ON `ratings` (`album_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`group_name` text DEFAULT 'Bum' NOT NULL,
	`join_code_hash` text NOT NULL,
	`joining_enabled` integer DEFAULT true NOT NULL,
	`rotation_epoch` text NOT NULL,
	`week_start_day` integer DEFAULT 1 NOT NULL,
	`week_start_hour` integer DEFAULT 0 NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`rotation_offset` integer DEFAULT 0 NOT NULL,
	`last_reconciled_week` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "settings_id_singleton" CHECK("settings"."id" = 1),
	CONSTRAINT "settings_week_start_day_range" CHECK("settings"."week_start_day" BETWEEN 0 AND 6),
	CONSTRAINT "settings_week_start_hour_range" CHECK("settings"."week_start_hour" BETWEEN 0 AND 23),
	CONSTRAINT "settings_joining_enabled_bool" CHECK("settings"."joining_enabled" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `skipped_turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_start` text NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "skipped_turns_kind" CHECK("skipped_turns"."kind" IN ('auto', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skipped_turns_week_user` ON `skipped_turns` (`week_start`,`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`rotation_order` integer NOT NULL,
	`joined_at` integer NOT NULL,
	CONSTRAINT "users_is_admin_bool" CHECK("users"."is_admin" IN (0, 1)),
	CONSTRAINT "users_is_active_bool" CHECK("users"."is_active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (lower("username"));