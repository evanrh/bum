-- Hand-adjusted (issue #15): written as a plain ALTER ADD COLUMN instead of
-- drizzle-kit's table-recreate form. The runtime migrator wraps each
-- migration in one transaction, so the recreate form's
-- `PRAGMA foreign_keys=OFF` is a no-op and `DROP TABLE users` fails
-- (users is the FK parent of albums/ratings/audit_log). ALTER ADD COLUMN
-- with a constant default is legal inside a transaction and keeps the
-- inline CHECK, so column layout differs only in position.
ALTER TABLE `users` ADD `is_original_admin` integer DEFAULT false NOT NULL CONSTRAINT "users_is_original_admin_bool" CHECK(`is_original_admin` IN (0, 1));--> statement-breakpoint
-- The original admin is the first user ever created (lowest id; autoincrement
-- order == join order — locked invariant, plans/README.md). No-op on a fresh
-- database (users is still empty at migration time; signup flags its first
-- user via application logic from then on).
UPDATE `users` SET `is_original_admin` = 1 WHERE `id` = (SELECT MIN(`id`) FROM `users`);
