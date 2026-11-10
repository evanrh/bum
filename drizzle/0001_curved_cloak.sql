DROP TABLE `skipped_turns`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`group_name` text DEFAULT 'Bum' NOT NULL,
	`join_code_hash` text NOT NULL,
	`joining_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "settings_id_singleton" CHECK("__new_settings"."id" = 1),
	CONSTRAINT "settings_joining_enabled_bool" CHECK("__new_settings"."joining_enabled" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_settings`("id", "group_name", "join_code_hash", "joining_enabled", "created_at", "updated_at") SELECT "id", "group_name", "join_code_hash", "joining_enabled", "created_at", "updated_at" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `rotation_order`;
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`action` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
ALTER TABLE `settings` ADD `rotation` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `last_rotated_week` text;
