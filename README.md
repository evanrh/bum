# Bum — album review club

A small, single-group web app for a group of friends: each week a different
member is on rotation to submit one album, everyone rates it (half-stars),
and a running record is kept.

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
