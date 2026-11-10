# T01 — Database foundation

Status: ⬜
Depends on: —

## Goal

Create the full data layer: Drizzle schema (6 tables), the first migration,
the migration runner, typed repository modules, a settings bootstrap, and a
demo seed script — all with thorough tests against real SQLite.

Read `plans/README.md` ("Canonical data model") first; it is the authority
for every column.

## Deliverables

### 1. Schema — `src/db/schema.ts`

Replace the placeholder with the six tables from the canonical model, in
this order: `settings`, `users`, `sessions`, `albums`, `ratings`,
`skipped_turns`. Requirements:

- All CHECK constraints, UNIQUEs, FKs, and `ON DELETE CASCADE`
  (ratings → albums) exactly as specified.
- Drizzle-specific notes: booleans as `integer({ mode: 'boolean' })`,
  booleans CHECKs expressed in the migration SQL (see below), `settings.id`
  with `CHECK (id = 1)`.
- Export types: `Settings`, `User`, `Session`, `Album`, `Rating`,
  `SkippedTurn` via `InferSelectModel` (and `*:Insert` variants).

### 2. Migration — `drizzle/`

Run `npx drizzle-kit generate` (config already exists at
`drizzle.config.ts`) to author `drizzle/0000_*.sql`. Verify the SQL carries
the CHECK/UNIQUE/FK constraints. Add npm scripts:

- `"db:generate": "drizzle-kit generate"`
- `"db:migrate": "node src/db/migrate.ts"`

### 3. Migration runner — `src/db/migrate.ts`

Programmatic runner (no drizzle-kit in production). Loads every SQL file in
`../drizzle/` (sorted), applies them through the same connection created by
`src/db/index.ts`, records rows in drizzle's `__drizzle_migrations`
journal (use drizzle-orm's built-in `migrate()` from
`drizzle-orm/better-sqlite3/migrator`). Prints a one-line summary. Exit
code 0 on success; non-zero with a clear error otherwise. Must be runnable
as `node src/db/migrate.ts` (native TS — remember `.ts` extensions in
imports).

### 4. Repositories — `src/db/repos/*.ts`

One module per aggregate, each receiving the `Db` instance explicitly
(no singletons inside repo modules):

- `users.ts` — `create({username, passwordHash, displayName, isAdmin})`
  (assigns `rotation_order = max+1`, returns the row), `getById`,
  `getByUsername` (case-insensitive), `count()`, `listActive()`
  (ascending `rotation_order`), `setAdmin`, `setActive`,
  `setRotationOrder(userId, order)`, `listAll()`.
- `sessions.ts` — `create(userId, ttlMs, now)` returns the **raw token**
  (24h+) and stores its sha256; `getByToken(token, now)` returns
  `{session, user}` or null (rejects expired, lazily deletes it);
  `deleteByToken`; `deleteExpired(now)` → count.
- `settings.ts` — `get(db)` auto-bootstraps the singleton row when missing:
  join code = `process.env.BOOTSTRAP_JOIN_CODE` or 8 cryptographically
  random crockford-base32 chars (both bcrypt-hashed, cost 12); when a code
  is randomly generated, `console.log` the plaintext **once** (first-run
  bootstrap UX); `rotation_epoch` default = Monday of the current week
  (UTC calendar); `verifyJoinCode(code)`; `rotate(join_code)` → returns
  new plaintext code, stores hash; `update(patch)` (validated upstream)
  with `updated_at` bump.
- `albums.ts` — `insert` (respects `week_start` UNIQUE; returns typed
  error marker `WEEK_TAKEN` on conflict), `getById`, `getByWeekStart`,
  `update` (admin edits), `delete`, `list({ submitterId?, sort?:
  'newest' | 'avg' , limit?, offset? })` with aggregate columns
  `avg_score` (1 decimal) and `rating_count` (left-join ratings), and
  `statsFor(albumIds)` for leaderboards.
- `ratings.ts` — `upsert(albumId, userId, {score, comment|null})` (updates
  score/comment/updated_at, preserves created_at), `remove(albumId,
  userId)`, `listForAlbum(albumId)` (joined with the rating user's id +
  display name), `getFor(albumId, userId)`.
- `skipped-turns.ts` — `record(weekStart, userId, kind)` idempotent
  (INSERT OR IGNORE, returns whether inserted), `listRecent(limit)`
  (joined with display names), `existsForWeek(weekStart)`.

### 5. Seed script — `src/db/seed.ts`

`node src/db/seed.ts [--force]` against `DATABASE_URL` (default
`./data/dev.db`): refuses to touch a DB that already has users unless
`--force`. Creates settings with a **known** join code (`SEED_JOIN_CODE`
env or ` bumseed`), an admin (`admin` / password `bumadmin1`) plus three
members, two past albums with full rating sets, and leaves the current
week empty. Deterministic timestamps relative to `Date.now()` so the
rotation history looks real. Note its username/password at the end of the
run.

### 6. Tests

`test/db/*.test.ts`. Each file opens a fresh `:memory:` db via
`createDatabase(':memory:')` and applies migrations before each file's
suite. Required cases (non-exhaustive, aim wide):

- migrations apply cleanly to an empty file and are idempotent
  (second run: no-op)
- `users`: NOCASE duplicate username rejected; `rotation_order`
  auto-increment across creations; `setActive(0)` removes from
  `listActive`; unique username survives a deactivated user (reactivation
  path)
- `settings`: `get()` bootstraps once and returns the same row on repeat;
  generated join code verifies with `verifyJoinCode`; `rotate()` invalidates
  the old code; BOOTSTRAP_JOIN_CODE is respected when set (restore env
  between tests)
- `albums`: UNIQUE `week_start` → `WEEK_TAKEN`; cascade deletes ratings;
  `list` sorting by newest and by avg; avg/rating_count correct with zero
  and many ratings
- `ratings`: upsert updates score + keeps `created_at`; CHECK rejects
  score 0 and 11 (via drizzle insert) ; self-vs-other removal permissions
  live in the service layer (T04) — here only repo behavior
- `skipped-turns`: double `record` of the same (week, user) inserts once;
  `existsForWeek` distinguishes kinds
- `sessions`: expired token returns null and is pruned; `deleteExpired`
  count correct

Also: **replace `test/smoke.test.ts`** with a `test/db/migrate.test.ts`
migration test once the real tests exist (delete the placeholder).

## Acceptance criteria

- [ ] `npm run db:generate` produces the migration; `drizzle/` contains the
      SQL with all CHECK/UNIQUE/FK constraints visible
- [ ] `node src/db/migrate.ts` creates a fully-populated empty schema (spot
      check with `sqlite3 data/dev.db .schema` or a test-only script)
- [ ] All 6 schema objects + repos exist with the exact columns of the
      canonical model
- [ ] Seed script populates demo data on a fresh DB and is idempotent by
      default (refuses without `--force`)
- [ ] `npm test` green; `npm run test:coverage` ≥ thresholds over
      `src/db/**`

## Out of scope

HTTP endpoints, permission logic, rotation math (T02), jobs (T05), UI.
