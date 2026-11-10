# T09 — Integration pass

Status: ⬜
Depends on: T01–T08

## Goal

Close the loop: verify the complete user journeys on the running stack
(dev server *and* Docker), fix the fallout, and finish the README/ops
notes. This is the "ship check" for the club.

## Deliverables

### 1. Smoke script — `scripts/smoke.sh`

A curl-driven end-to-end against a running dev server (`npm run dev` or
the built `node dist/server/entry.mjs` with a temp `DATABASE_URL`):

1. Read the bootstrap join code (from the server's first-run log — the
   script may start the server itself and wait for its readiness line).
2. Signup admin → cookie jar A. Signup members B, C, D.
3. `GET /` — 200 and contains the group name.
4. Submit an album as admin (admin is the first picker) with a real
   Spotify album URL (from a fixture list in the script) → 201.
5. Members B and C rate it (scores 7 and 10, comments) → album detail
   shows avg 8.5 via the API.
6. B tries to submit → 403 (not picker). B rates again → upsert works
   (same score count).
7. Admin: change group_name; add a member via join code; rotate the join
   code; old code now fails signup (401/403).
8. Admin skip: validate via the API (skip → new picker for the
   remainder, audit log gains a `queue.override` row) and verify B is
   now the picker by B submitting successfully.
9. Log out + anonymous `GET /api/albums` → 200 (public read), and a
   mutation → 401.

Exit non-zero on first failure; `-v` prints bodies. Keep the fixtures
(3 albums with real IDs) at the top of the script.

**Run the same script inside Docker** (`docker compose up` target) with
the bootstrap env var set — the compose flow must pass it too.

### 2. Seed walkthrough — docs

Update `README.md` with the final, honest quickstart:

```
git clone … && npm install
npm run db:migrate && npm run db:seed   # or just `npm run dev`
- log prints the bootstrap join code on first run
- signup with it → first account = admin
```

Plus ops notes: data location, join-code rotation UI pointer, timezone
(hardcoded `America/New_York` — the app assumes Eastern by design),
backup one-liner, jobs container behavior, and a troubleshooting table
(WAL lock with two writers, stale session after restoring an old DB,
`last_rotated_week` rewinds on manual DB swaps → the job replays the
missed weeks exactly once).

### 3. Full-suite verification

- `npm run test:coverage` — thresholds enforced; chase down any module
  under 80% (exceptions: pure render code documented with a skip-comment
  if genuinely DOM-only; prefer real tests over churn).
- `npm run typecheck` + `npm run build` clean.
- T08 acceptance checklist re-run (the compose flow).
- Manual pass of every T06 page + T07 panel against the seeded DB
  (`src/db/seed.ts`), recording anything janky as follow-up notes in this
  ticket's *Deviations & notes*.

### 4. Fix budget

This ticket is expected to produce small fixes across earlier tickets
(validation gaps, copy, a11y). Fix them **in place in their own modules**,
with commits still prefixed by the owning ticket number (`fix(T04): …`)
— do not reassign feature ownership.

## Acceptance criteria

- [ ] `scripts/smoke.sh` passes against the dev server **and** the
      Docker compose stack
- [ ] Coverage thresholds met; typecheck+build clean
- [ ] README quickstart works on a pristine clone directory (verify by
      running it with a fresh `DATABASE_URL`)
- [ ] No console errors during the manual pass on any page
- [ ] All tickets T01–T08 are ✅; any known gaps recorded in Deviations
      sections

## Out of scope

New features (write a new ticket instead), CI, monitoring infrastructure.
