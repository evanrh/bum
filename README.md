# Bum — album review club

A small, single-group web app for a group of friends: each week a different
member is on rotation to submit one album, everyone rates it (half-stars),
and a running record is kept.

## Quickstart

```sh
git clone https://github.com/evanrh/bum.git && cd bum
npm install
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
- node-cron scheduled jobs (separate process/container)
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

## Docker

```sh
docker compose build          # once (the image is shared by all services)
docker compose up -d          # migrate (one-shot) → web :4321 + jobs
docker compose ps             # migrate exited(0), web/jobs running
docker compose logs -f web    # first run prints the join code once
```

- The database is a single SQLite file bind-mounted from `./data/bum.db`
  (WAL mode handles the web + jobs concurrency).
- Rotate the join code from the admin panel (`/admin`), or set
  `BOOTSTRAP_JOIN_CODE` in `.env` before the first boot to pin it.
- Backup: `docker compose stop` then copy `data/bum.db` (WAL: stop first),
  or `sqlite3 data/bum.db ".backup data/backup.db"`.
- Single-container alternative (web only, no scheduled jobs):

  ```sh
  docker run --init -v "$PWD/data:/data" \
    -e DATABASE_URL=/data/bum.db -p 4321:4321 bum-web
  ```

- `.env.example` lists the environment knobs; values are wired in
  `docker-compose.yml` by default.
```

## Project layout

- `src/db/` — Drizzle schema, connection, migrations
- `src/lib/` — framework-agnostic domain logic (rotation, auth, etc.)
- `src/jobs/` — cron job runner (runs as its own process/container)
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
| Container signup rejects every join code | In containers the bootstrap code comes from `BOOTSTRAP_JOIN_CODE` — make sure it's passed to **both** the `web` and `jobs` services (the jobs process may bootstrap settings first). |
