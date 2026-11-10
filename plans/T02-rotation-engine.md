# T02 — Rotation queue (schema amendment + rotation helpers)

Status: ✅
Depends on: T01

> **Redesigned 2026-11-10** (see T01's *Deviations & notes*): offset/index
> rotation math is replaced by an explicit queue in `settings.rotation`,
> US Eastern is hardcoded, and `skipped_turns` becomes a generic
> `audit_log`. This ticket applies the schema amendment, updates the
> repos, and builds the pure helpers that T05 and T07 both consume.

## Goal

1. Amend the T01 schema to the queue model (one new migration, applying
   cleanly to an existing T01 database).
2. Update the `settings`/`users` repos, add an `audit` repo, delete the
   skipped-turns repo.
3. Implement the pure rotation helpers in `src/lib/rotation.ts` — no DB
   access, no astro imports.

## Spec

### 1. Schema amendment — `drizzle/0001_*.sql`

Edit `src/db/schema.ts`, then `npx drizzle-kit generate`:

- `settings`: drop `rotation_epoch`, `week_start_day`,
  `week_start_hour`, `timezone`, `rotation_offset`,
  `last_reconciled_week`; add `rotation TEXT NOT NULL DEFAULT '[]'`
  (JSON array of user ids; head = current picker) and
  `last_rotated_week TEXT` (ISO Monday; weekly job checkpoint).
- `users`: drop `rotation_order`.
- Drop `skipped_turns`; create `audit_log`:

  ```
  audit_log
    id INTEGER PK AUTOINCREMENT
    actor_user_id INTEGER REFERENCES users(id)  -- null = system (jobs)
    action TEXT NOT NULL      -- 'queue.advance' | 'queue.override' | …
    detail TEXT
    created_at INTEGER NOT NULL
  ```

- `src/db/seed.ts`: seed `rotation` with the seeded users in join order
  (admin first); drop all epoch/offset fields; leave `last_rotated_week`
  null (the jobs process bootstraps it).
- Delete `src/db/repos/skipped-turns.ts` and
  `test/db/skipped-turns.test.ts`.

### 2. Repos

- `settings.ts` — `getRotation(): number[]` (parses the JSON, tolerant
  of empty), `setRotation(ids: number[])`, `setLastRotatedWeek(week:
  null | string)`. Everything epoch/offset-related goes away; `get()`'s
  bootstrap no longer sets epoch fields.
- `users.ts` — `create()` no longer assigns `rotation_order`;
  `listActive()` orders by `joined_at` instead; delete
  `setRotationOrder` and its test coverage.
- New `src/db/repos/audit.ts` — `record({actorUserId, action,
  detail?})` and `listRecent(limit)` (joined with the actor's display
  name; a null actor renders as "system" upstream).

### 3. Pure helpers — `src/lib/rotation.ts`

```ts
export const TIMEZONE = 'America/New_York'; // locked ops assumption

// Week ids are ISO Mondays in TIMEZONE — pure calendar arithmetic, no
// boundary-hour concept. daysBetweenISO uses Date.UTC parts, so a DST
// week (23/25 h) still counts as exactly 7 days.
easternDateParts(now: Date): { y: number; m: number; d: number } // Intl, timeZone: TIMEZONE
weekId(now: Date): string                    // Monday of now's Eastern calendar week
weekStartsAt(week: string): Date             // Monday 00:00 TIMEZONE as an instant
addWeeksISO(week: string, n: number): string
daysBetweenISO(a: string, b: string): number // a − b, calendar days

// queue ops over user ids
parseQueue(json: string | null): number[]
rotateQueue(queue: number[]): { queue: number[]; moved: number | null }
                             // pop head → append; empty → no-op (moved: null)
pendingAdvances(lastRotatedWeek: string | null, currentWeek: string): number
                             // null checkpoint → 0 (bootstrap elsewhere);
                             // else daysBetweenISO(current, last) / 7

// app-facing convenience
currentTurn(settings: { rotation: string | null }, now: Date):
  { week: string; pickerId: number | null; startedAt: Date; endsAt: Date }
```

`weekStartsAt` converts an Eastern wall-clock Monday 00:00 into an
instant by seeding `Date.UTC(y, m, d, 4)` (the EDT candidate) and
adjusting ±1 h from `Intl`-formatted Eastern parts until the local hour
reads 00. That is the only DST-aware code in the app — a handful of
lines, tested on both transitions. Everything else is calendar-day
arithmetic.

## Tests — `test/lib/rotation.test.ts` + `test/db/rotation-schema.test.ts`

Keep tests timezone-explicit by pinning instants (Unix ms computed once
against known Eastern wall clocks) — never host-zone-dependent.

- `weekId`: pinned instants for known Mondays; an instant that is Sunday
  23:30 Eastern (belongs to the week that started 6 days earlier);
  instants across both DST Sundays (the Eastern calendar date decides, so
  the clock shift changes nothing)
- `weekStartsAt`: spring-forward Monday (00:00 EDT → 04:00Z) and
  fall-back Monday (00:00 EST → 05:00Z); `currentTurn().endsAt` is the
  next Monday's instant
- `daysBetweenISO`/`addWeeksISO`: across month and year boundaries
- `rotateQueue`: 0/1/n members; a single-member rotate is a compositional
  no-op; order otherwise preserved
- `pendingAdvances`: equal weeks → 0; null checkpoint → 0; 1/3/12
  elapsed; a range spanning a DST transition is still exactly one
  advance per calendar week
- schema test: apply the committed 0000 then 0001 migrations to a fresh
  DB; old columns/tables gone, new columns + `audit_log` present,
  `rotation` default `'[]'` round-trips
- repos: `setRotation`/`getRotation` round-trip (incl. empty and
  single-element); audit `record` with and without actor; `listRecent`
  shaping and limit

## Acceptance criteria

- [x] `drizzle/0001_*.sql` applies on top of a real T01-migrated
      database without touching user data (staged-upgrade test seeds
      rows in the old shape and asserts they survive)
- [x] `src/lib/rotation.ts` exports the surface above (no DB/astro
      imports); 100% statement/line coverage of it
- [x] `skipped_turns` fully gone (schema, repo, tests)
- [x] `npm test` / `npm run test:coverage` / `npm run typecheck` /
      `npm run build` green

## Out of scope

Who calls the helpers when (T03 signup append, T05 weekly advance, T07
admin skip), endpoints, UI.
