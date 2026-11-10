# T05 — Jobs

Status: ⬜
Depends on: T01, T02

## Goal

The scheduled-job process: a node-cron runner in `src/jobs/` that performs
the daily rotation reconciliation (auto-skips). Runs as its own process (`node src/jobs/run.ts`) and, later, its own
container (T08).

## Deliverables

### 1. Reconciliation — `src/jobs/reconcile.ts`

Export `reconcile(db, {now, log})` — idempotent, correct across restarts
and downtime:

1. Load settings; `settings.last_reconciled_week` is the checkpoint
   (null = never ran → process from `rotation_epoch`'s week onward).
2. Determine every week start (ISO) from the checkpoint **up to and
   including the most recently fully-ended week** (`addWeeksISO(current,
   -1)`). The current week is never skipped — it's in progress.
3. For each such week: picker = `pickerFor(users as-of-now,
   weekIndex(w), rotation_offset)`. If a picker exists and
   `albums.getByWeekStart(w)` is missing → `skippedTurns.record(w, picker,
   'auto')` (INSERT OR IGNORE: existing `'admin'` rows stand; existing
   `'auto'` rows are no-ops).
   - Historical-fidelity note: picker identity for past weeks is computed
     with *today's* member list/offset. Auto-skips only ever target a
     week's original picker when nothing changed; admin skips bump offset
     and record themselves — reconcile must **not** write a second row for
     the same (week, user) and must accept that an admin skip already
     covered the week. The UNIQUE(week_start, user_id) constraint does the
     heavy lifting; the `record` no-op behavior keeps this correct.
4. Advance `settings.last_reconciled_week` to the last processed week
   **only if** processing reached it (do not advance when an error
   occurred mid-loop).
5. One-line summary log: weeks processed, skips recorded;
   full list of new skip rows at debug level.

Failures: let the process crash on unexpected DB errors (supervisor-level
restart is the policy; the checkpoint prevents double-recording) — but a
thrown error must leave the checkpoint unchanged (advance it last).

### 2. Entrypoint — `src/jobs/run.ts`

- On boot: run `migrate` logic (reuse `src/db/migrate.ts`'s exported
  function — refactor it to export `applyMigrations(db)`), then
  `reconcile` **once immediately** (safe/idempotent), then schedule
  node-cron: daily at `00:10` **in the configured timezone** (`cron.schedule('10 0 * * *', …, { timezone })`; re-read the timezone from
  settings on each invocation so admin edits apply without restart — if
  node-cron can't re-read dynamically, reschedule on change).
- If `process.env.JOBS_CRON='off'`: run once and exit (useful for tests
  and one-shot containers).
- Graceful SIGTERM/SIGINT: stop the task and exit 0. Log "jobs runner
  ready" with the active timezone at boot.

### 3. Tests — `test/jobs/*.test.ts`

Fixture builder: settings (epoch = known Monday, tz UTC, day 1,
hour 0) + 4 members + helper to set `now`.

- A ended week where picker submitted → no skip row.
- An ended week with no submission → `'auto'` row for the week's picker;
  **second run writes nothing** (idempotence) and checkpoint advances
  once.
- The current week is in progress with no submission → no row.
- Never-reconciled db (null checkpoint) → processes all weeks since
  epoch in one run.
- Catch-up after "downtime": simulate by running reconcile with now =
  week N, then now = week N+3 → processes N+1, N+2, N+3's predecessor,
  checkpoint lands on N+2; nothing from N+3's week-onward.
- Admin skip pre-recorded for (week, user) → reconcile adds no `auto`
  row for that pair; UNIQUE constraint would have caught it anyway —
  assert `record` returned `inserted: false` and only one row exists.
- DST: settings with America/New_York across a transition — reconcile
  processes boundary weeks correctly (calendar-day logic from T02).
- Zero members → no rows, no crash; negative weekIndex (epoch in future)
  → immediate no-op with checkpoint unset.
- Entrypoint (no-cron path): `JOBS_CRON=off` runs reconcile once and
  exits 0 (assert via the exported `runOnce()` function; keep `run.ts`
  itself a thin wrapper so tests import `runOnce` with injected db).

## Acceptance criteria

- [ ] `node src/jobs/run.ts` boots, applies migrations, reconciles, logs
      readiness; `JOBS_CRON=off node src/jobs/run.ts` exits 0
- [ ] Reconciliation is idempotent across restarts; a fresh DB can
      "catch up" many weeks in a single run
- [ ] `npm test` / coverage green (coverage includes `src/jobs/**`)

## Out of scope

Admin skip endpoint (T07 — that's a synchronous request path), any
delivery of alerts (none exists yet), Dockerization (T08).
