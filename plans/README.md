# Bum — implementation tickets

This directory is the execution plan for the Bum app. Each ticket is a
self-contained brief for one delegated agent run. `plans/README.md` is the
**single source of truth** for technical decisions; tickets reference it
instead of repeating it.

**Read this file in full before starting any ticket.**

## Ticket index

| # | Ticket | Depends on | Status |
|---|---|---|---|
| T01 | [Database foundation](T01-database-foundation.md) | — | ✅ |
| T02 | [Rotation engine](T02-rotation-engine.md) | T01 (types only) | ⬜ |
| T03 | [Auth & sessions](T03-auth-and-sessions.md) | T01, T02 | ⬜ |
| T04 | [Albums & ratings](T04-albums-and-ratings.md) | T01, T02, T03 | ⬜ |
| T05 | [Jobs](T05-jobs.md) | T01, T02 | ⬜ |
| T06 | [Pages & islands](T06-pages-and-islands.md) | T01–T04 | ⬜ |
| T07 | [Admin panel](T07-admin-panel.md) | T01–T05 | ⬜ |
| T08 | [Docker](T08-docker.md) | T01–T05 | ⬜ |
| T09 | [Integration pass](T09-integration-pass.md) | T01–T08 | ⬜ |

Status values: ⬜ not started · 🚧 in progress · ✅ done (all acceptance
criteria checked).

## Delegation protocol

1. **One ticket per agent run.** Pick the lowest-numbered ticket whose
   dependencies are ✅.
2. Read the ticket top to bottom, then implement. Do not start dependent
   work belonging to later tickets "while you're in there".
3. Every ticket carries its own tests. The suite (`npm test`) and the build
   (`npm run build && npm run typecheck`) must pass before the commit.
4. Commit format: `feat(T03): auth & sessions` (or `fix(T03): …`,
   `refactor(T03): …`). One ticket may produce a few commits; prefix each
   with its ticket number.
5. When acceptance criteria are all met: update the ticket's `Status:` line
   and the index above (🚧 → ✅). If work is genuinely blocked, leave 🚧 and
   append a **Deviations & notes** section explaining the blocker.
6. **Never rewrite a completed ticket's requirements.** Clarifications and
   discovered edge cases go into the ticket's *Deviations & notes* section
   so later tickets and reviewers can see the history.
7. If a ticket needs a new dependency, install it in that ticket and record
   it in its *Deviations & notes* section.

## Locked technical decisions

| Concern | Decision |
|---|---|
| Framework | Astro 5, `output: 'server'`, `@astrojs/node` standalone adapter |
| Interactive UI | React 19 islands (`client:load`/`client:visible`) inside server-rendered Astro shells |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite`; no other CSS system |
| Database | SQLite via `better-sqlite3` (synchronous driver), WAL mode |
| ORM / migrations | Drizzle ORM; `drizzle-kit generate` authoring, migrations applied programmatically (`src/db/migrate.ts`) and as a one-shot compose step |
| Auth | Per-user username + password (bcrypt, cost 12); rotatable join code gates signup; DB-backed sessions in HttpOnly cookies |
| Scheduled jobs | node-cron in a separate long-lived process (its own container in compose) |
| Validation | Zod at every boundary (HTTP payloads, settings updates) |
| Language / runtime | TypeScript (strict, `erasableSyntaxOnly`), Node >= 24 |
| Runtime TS execution | Node 24 native type-stripping — all intra-project imports include the `.ts` extension; no enums/namespaces/parameter properties |
| Testing | Vitest + `@vitest/coverage-v8`; RTL for React islands; coverage ≥ 80% statements/lines/functions, ≥ 75% branches over `src/lib`, `src/db`, `src/jobs` (via `npm run test:coverage`) |

## Canonical data model

Six tables. Timestamps are `INTEGER` unix epoch **milliseconds**; week
identifiers are `TEXT` ISO `YYYY-MM-DD` dates. Booleans are `INTEGER`
0/1. The schema lives in `src/db/schema.ts`.

```
settings      singleton (id = 1)
  id INTEGER PK CHECK (id = 1)
  group_name TEXT NOT NULL DEFAULT 'Bum'
  join_code_hash TEXT NOT NULL                -- bcrypt hash of the signup join code
  joining_enabled INTEGER NOT NULL DEFAULT 1  -- admin can close signup
  rotation_epoch TEXT NOT NULL                -- ISO date; start of week 0
  week_start_day INTEGER NOT NULL DEFAULT 1   -- 0=Sun … 6=Sat
  week_start_hour INTEGER NOT NULL DEFAULT 0  -- 0-23, boundary hour
  timezone TEXT NOT NULL DEFAULT 'UTC'        -- IANA zone
  rotation_offset INTEGER NOT NULL DEFAULT 0  -- bumped by admin skips
  last_reconciled_week TEXT                   -- ISO date checkpoint for T05
  created_at, updated_at INTEGER NOT NULL

users
  id INTEGER PK AUTOINCREMENT
  username TEXT NOT NULL UNIQUE COLLATE NOCASE  -- 3-32 [A-Za-z0-9_-]
  password_hash TEXT NOT NULL
  display_name TEXT NOT NULL                    -- 1-64 chars
  is_admin INTEGER NOT NULL DEFAULT 0
  is_active INTEGER NOT NULL DEFAULT 1          -- soft "deletion"
  rotation_order INTEGER NOT NULL               -- join order; admin-reorderable
  joined_at INTEGER NOT NULL

sessions
  id INTEGER PK AUTOINCREMENT
  token_hash TEXT NOT NULL UNIQUE               -- sha256 hex of cookie token
  user_id INTEGER NOT NULL REFERENCES users(id)
  created_at INTEGER NOT NULL
  expires_at INTEGER NOT NULL                   -- 30d from creation

albums
  id TEXT PK                                    -- uuid v4 (crypto.randomUUID)
  title TEXT NOT NULL                           -- 1-200
  artist TEXT NOT NULL                          -- 1-200
  year INTEGER                                  -- optional, 1900-2100
  submitted_by INTEGER NOT NULL REFERENCES users(id)
  submitted_at INTEGER NOT NULL
  week_start TEXT NOT NULL UNIQUE               -- one album per week, max
  spotify_id TEXT                               -- parsed from a pasted URL
  youtube_id TEXT
  cover_url TEXT                                -- resolved best-effort
  note TEXT                                     -- optional, ≤ 1000 chars

ratings
  id INTEGER PK AUTOINCREMENT
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE
  user_id INTEGER NOT NULL REFERENCES users(id)
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10)  -- half-stars × 2
  comment TEXT                                  -- optional, ≤ 2000 chars
  created_at, updated_at INTEGER NOT NULL
  UNIQUE (album_id, user_id)

skipped_turns
  id INTEGER PK AUTOINCREMENT
  week_start TEXT NOT NULL
  user_id INTEGER NOT NULL REFERENCES users(id)
  kind TEXT NOT NULL CHECK (kind IN ('auto', 'admin'))
  recorded_at INTEGER NOT NULL
  UNIQUE (week_start, user_id)
```

## Rotation semantics (locked)

- `activeMembers` = users with `is_active = 1`, sorted ascending by
  `rotation_order`.
- Given settings `{rotation_epoch, week_start_day, week_start_hour,
  timezone, rotation_offset}`:
  - `weekStart(now)` = the most recent instant matching the configured
    day/hour in the configured timezone. `week_start` is the ISO **date**
    of that boundary's day.
  - `weekIndex(week_start)` = calendar days between `week_start` and
    `rotation_epoch`'s (normalized) week start ÷ 7, floored. Calendar-day
    based on purpose: week boundaries must not drift under DST. Days
    count via `Date.UTC(y, m, d)` differences.
  - `picker = activeMembers[mod(weekIndex + rotation_offset, n)]` where
    `mod` is Euclidean (always ≥ 0). `n = 0` (no members) → no picker.
- Before `rotation_epoch` (negative week index): submissions disabled with
  a clear error ("club hasn't started"); the epoch is normalized to its own
  week start when read, so partial weeks are never negative.
- **Weekly auto-skip** (T05 job): when a week has ended and its picker did
  not submit, a `skipped_turns (week, picker, 'auto')` row is recorded.
  Rotation is never blocked; the next member simply takes over.
- **Admin skip** (T07): bumps `rotation_offset` by exactly 1 and records
  `skipped_turns (current week, current picker, 'admin')`. Semantics: the
  current picker's turn is burned (moves to the end of the current cycle
  order); everyone after them takes their slot one week early. The standing
  `rotation_order` is untouched. Allowed even if the picker had already
  submitted (album stays, admin may delete it themselves); the skip button
  is disabled once a skip row exists for that week.

## Auth & permissions (locked)

- Cookie: name `bum_session`, value = 32 random bytes (base64url); the DB
  stores sha256 of it. HttpOnly, SameSite=Lax, Path=/, 30-day expiry,
  `Secure` when the request is https. Astro's built-in session feature is
  disabled in `astro.config.mjs` (`session: false`) — we roll our own.
- Signup requires the join code (bcrypt-verified) while
  `joining_enabled = 1`. The **first user ever created becomes admin**.
  The plaintext join code is only shown at generation time.
- Passwords: bcrypt cost 12. Login rate limit: in-memory, 10 attempts per
  IP per 15 minutes (restart resets it; acceptable).
- Mutation endpoints (`POST`/`PUT`/`DELETE`) verify `Origin`/`Referer`
  matches the request host when the header is present (CSRF guard for
  cookie auth). `GET` is exempt.
- Permissions: admins can do everything (any album/rating edit or delete,
  user management, rotation settings, join code, skips). Members rate
  anything anytime and edit/delete **their own** rating; they submit only
  during their assigned week. Deactivated members keep history but cannot
  log in.

## External IDs, embeds, covers (locked)

- Users paste full URLs; we parse server-side and store IDs:
  - Spotify album: `open.spotify.com/album/{id}` or `/embed/album/{id}`
    (id = base62, match `[A-Za-z0-9]{10,64}`). Playlist/track/user URLs are
    rejected with a helpful error.
  - YouTube: `youtube.com/watch?v={id}`, `youtu.be/{id}`,
    `music.youtube.com/watch?v={id}`, `youtube.com/embed/{id}`; id =
    `[A-Za-z0-9_-]{11}`. Playlists (`list=` param without a video id) are
    rejected.
- At least one external link is not required (manual title/artist entry is
  valid); if only a YouTube ID exists there is no spotify_id, and vice
  versa.
- Embeds (no API keys, no auth): Spotify
  `https://open.spotify.com/embed/album/{id}` (compact, 152px);
  YouTube `https://www.youtube-nocookie.com/embed/{id}` (16:9).
- Cover art: with a `spotify_id`, fetch `https://open.spotify.com/oembed/?url=https://open.spotify.com/album/{id}`
  (public oEmbed, 5s timeout) and store `thumbnail_url` as `cover_url`;
  with only a `youtube_id`, use `https://i.ytimg.com/vi/{id}/hqdefault.jpg`.
  Failure is non-fatal: `cover_url` stays null and the UI shows a gradient
  placeholder.

## Conventions

- **Imports inside `src/**` always include the `.ts` extension** (Node
  native TS + Vitest + Vite all resolve it; keeps the jobs process
  dependency-free of bundlers). Never enable path aliases.
- Framework code (`src/pages`, `src/middleware.ts`, React islands) may
  import `astro`/`react`; `src/lib`, `src/db`, `src/jobs` stay
  **framework-agnostic** (no astro imports) — that's what makes unit tests
  clean.
- Every mutating API endpoint validates input with a Zod schema and replies
  errors as `{ error: string }` with the right status (400 validation, 401
  unauthenticated, 403 forbidden, 404 missing, 409 conflict, 429 rate
  limited).
- Timestamps: `Date.now()` ms; dates: ISO `YYYY-MM-DD` strings.
- Tests live in `test/` mirroring the source tree. DB tests open a fresh
  `:memory:` database (or temp file when WAL semantics matter), run
  migrations, and hit real SQL — no mocking the DB layer.
- Commands: `npm test` (fast), `npm run test:coverage` (thresholds
  enforced), `npm run typecheck`, `npm run build`.
