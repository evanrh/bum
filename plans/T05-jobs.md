# T05 — Jobs

Status: ✅
Depends on: T01, T02

## Goal

The scheduled-job process: a node-cron runner in `src/jobs/` that advances
the rotation queue at week boundaries. Runs as
its own process (`node src/jobs/run.ts`) and, later, its own container
(T08).

## Deliverables

### 1. Queue advance — `src/jobs/advance.ts`

Export `advanceRotation(db, {now, log})` — idempotent, correct across
restarts and downtime:

1. Load settings; `currentWeek = weekId(now)` (T02 helpers).
2. `pending = pendingAdvances(settings.last_rotated_week, currentWeek)`.
3. Null checkpoint → set `last_rotated_week = currentWeek` and stop
   (bootstrap: the admin-defined queue order starts as-is; no rotation,
   no audit row).
4. For each of the `pending` elapsed weeks, oldest first, in one
   transaction per week: `rotateQueue` (pop head → append; skip silently
   when the queue is empty), write an `audit_log` row (actor null, action
   `queue.advance`, detail naming the week), then move
   `last_rotated_week` forward one week. The checkpoint advances only
   for completed weeks — a crash leaves it where it was.
5. One-line summary log: advances applied.

Failures: let the process crash on unexpected DB errors (supervisor-level
restart is the policy) — idempotence makes the next run a no-op.

### 2. Entrypoint — `src/jobs/run.ts`

- On boot: apply migrations (reuse `src/db/migrate.ts`'s exported
  `applyMigrations(db)`), run `advanceRotation` once immediately (safe /
  idempotent), then schedule node-cron: daily at `00:15` with
  `{ timezone: 'America/New_York' }` (hardcoded — the same locked
  assumption as the week math). Daily scheduling is belt-and-braces:
  `advanceRotation` itself decides how many weeks were missed, so a
  missed Monday self-heals on the next run.
- If `process.env.JOBS_CRON === 'off'`: run once and exit (export a
  `runOnce()` the tests import; keep `run.ts` itself a thin wrapper).
- Graceful SIGTERM/SIGINT: stop the task and exit 0. Log "jobs runner
  ready" at boot.

### 3. Tests — `test/jobs/*.test.ts`

Fixture builder: migrate a fresh `:memory:` DB, seed settings with queue
`[A,B,C,D]` and null checkpoint; inject `now`.

- Bootstrap run (null checkpoint) → checkpoint set, no rotation, no audit
  rows.
- One elapsed week → single advance: queue `[B,C,D,A]`, one
  `queue.advance` audit row, checkpoint = the advanced-from week.
- Catch-up after simulated downtime: run with `now` = week N, then
  `now` = week N+3 → exactly 3 advances in order, each audited; a second
  run is a no-op.
- Same-week reruns (the daily cron) → nothing happens.
- Empty queue → no rotation, no audit rows, checkpoint still advances.
- DST week: a range spanning an America/New_York transition still
  advances exactly once per calendar week (calendar-day math from T02).
- `JOBS_CRON=off` entrypoint path: `runOnce()` exits 0.

## Acceptance criteria

- [x] `node src/jobs/run.ts` boots, migrates, advances, logs
      readiness; exits 0 under `JOBS_CRON=off` (live-verified: first run
      bootstraps the checkpoint, second run logs `0 week(s) advanced`,
      cron boot logs readiness and shuts down cleanly on SIGTERM)
- [x] Down for 3 weeks → exactly 3 advances on the first run back;
      repeat runs are no-ops
- [x] `npm test` / coverage green (169 tests; coverage 90/88.5/90/90.6,
      `advance.ts` at 100% statements — `run.ts`'s CLI boot block is the
      OS-integration surface, exercised by the live smoke and T09)

## Out of scope

Admin skip (T07 — a synchronous request path), alerting (none exists),
Dockerization (T08).
