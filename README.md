# Bum — album review club

A small, single-group web app for a group of friends: each week a different
member is on rotation to submit one album, everyone rates it (half-stars),
and a running record is kept.

## Quickstart

```sh
git clone https://github.com/evanrh/bum.git && cd bum
npm install
export SITE_URL=http://localhost:4321   # the runtime origin — dev needs it too (issue #39)
npm run db:migrate && npm run db:seed   # demo data: admin/bumadmin1 + 3 members
npm run dev                             # http://localhost:4321
```

- Skipping the seed: the first-run log prints the bootstrap join code —
  signup with it and the first account becomes the admin.
- Demo credentials (after `db:seed`): user `admin`, password `bumadmin1`,
  join code `bumseed`.

## Stack

- Astro 5 (SSR, `@astrojs/node` standalone adapter) + React islands
- Tailwind CSS v4
- SQLite via `better-sqlite3` + Drizzle ORM (SQL migrations via `drizzle-kit`)
- node-cron scheduled jobs, supervised inside the single container
- Vitest for unit tests, TypeScript throughout, Node >= 24

The runtime runs TypeScript natively (Node 24 type stripping), so all
intra-project imports use explicit `.ts` extensions and TypeScript is
restricted to erasable syntax (`erasableSyntaxOnly`).

## Commands

```sh
npm install        # install
npm run dev        # dev server at http://localhost:4321
npm run build      # production build (outputs dist/)
npm test           # unit tests
npm run test:coverage
npm run typecheck  # tsc --noEmit
npm run icon       # regenerate public/icon.png (favicon + OG fallback)

## Docker — one image, one container

The image runs a `boot` entrypoint: it validates the environment, applies
migrations, then supervises the web server and the nightly cron as two
processes. Nothing is baked at build time — configure with env only.

```sh
docker compose up -d --build  # one service: migrate + web :4321 + jobs
docker compose ps             # one running container
docker compose logs -f bum    # first run prints the join code once
```

- `SITE_URL` (from your `.env` or environment) is **required at startup**
  (issue #39): compose passes it through, and `${SITE_URL:?}` fails the
  compose command with a message when it is missing. It is the public
  origin for OG links, minted per request — changing it only means
  restarting the container, never rebuilding.
- The database is a single SQLite file bind-mounted from `./data/bum.db`
  (WAL mode handles the web + jobs concurrency).
- Rotate the join code from the admin panel (`/admin`), or set
  `BOOTSTRAP_JOIN_CODE` in `.env` before the first boot to pin it.
- Repair stale cover art manually when you like (idempotent; exits 1 if
  some resolutions failed so it can simply be re-run when the network
  cooperates):

  ```sh
  docker exec <bum container> node dist/jobs/backfill-covers.mjs
  ```

- Backup: `docker compose stop` then copy `data/bum.db` (WAL: stop first),
  or `sqlite3 data/bum.db ".backup data/backup.db"`.
- Raw-docker alternative:

  ```sh
  docker build -t bum .
  docker run --name bum -e SITE_URL=https://bum.example.com \
    -v "$PWD/data:/data" -p 4321:4321 bum
  ```

- `.env` is read by docker compose (it interpolates `SITE_URL`/`BOOTSTRAP_JOIN_CODE`
  into the container env); `npm run dev` does **not** read `.env` — export
  `SITE_URL` in the shell instead.
```

## Project layout

- `src/db/` — Drizzle schema, connection, migrations
- `src/lib/` — framework-agnostic domain logic (rotation, auth, etc.)
- `src/jobs/` — boot entrypoint (env → data dir → migrations → supervisors) and the cron runner
- `src/pages/` — Astro pages + `/api` JSON endpoints
- `test/` — vitest unit tests

## Development model

Feature work is tracked as self-contained tickets in [`plans/`](plans/README.md),
ordered by dependency and delegated to agents one at a time. Read
`plans/README.md` first — it carries the locked technical decisions,
the canonical data model, and the ticket index.

## Troubleshooting

| Symptom | Cause + fix |
|---|---|
| `SQLITE_BUSY` / "database is locked" | Two long write transactions colliding (web + jobs share one SQLite file in WAL mode). Writes are short-lived; retry. If it recurs on every boot, make sure only one process is starting from a migrated DB. |
| Everyone logged out after a restart | The sessions store is in-memory by design (locked decision) — sessions clear when the process restarts. Fresh logins rebuild them. |
| Job "replays" several weeks after a restore | `settings.last_rotated_week` is part of the DB — restoring an older backup rewinds the checkpoint, and the next jobs run re-advances each missed week exactly once. |
| Week boundaries look off by an hour | Weeks are fixed Mondays 00:00 in `America/New_York` by design (single-operator deployment); DST shifts the clock, never the calendar week. |
| Container signup rejects every join code | The bootstrap code is created once from `BOOTSTRAP_JOIN_CODE` (or printed to the container log) — make sure the env was set on the **first** boot; after that, rotate the code from `/admin`. |
| Container exits with "SITE_URL is required at runtime" | Set `SITE_URL` (absolute http(s) URL) in the container env — compose reads your `.env`, `docker run` needs `-e SITE_URL=…`. |
