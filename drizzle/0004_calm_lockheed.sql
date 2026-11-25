-- Issue #50: profile pictures — one optional in-row BLOB per member so the
-- avatar lives in the same durable SQLite file as everything else (the Docker
-- image is read-only outside /data). Pure CREATE: users is untouched, so the
-- ALTER-tables transaction hazard from migration 0003 does not apply here.
CREATE TABLE `avatars` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`data` blob NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
