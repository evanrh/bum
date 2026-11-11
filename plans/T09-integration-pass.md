# T09 — Integration pass

Status: ✅
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
(WAL lock with two writers, `last_rotated_week` rewinds on manual DB
swaps → the job replays the missed weeks exactly once).

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
- [x] Coverage thresholds met (90.6/86.0/92.3/91.6); typecheck+build clean
- [x] README quickstart verified on a pristine `DATABASE_URL` (migrate +
      seed → demo credentials printed)
- [x] No console errors during the rendered-page pass (server logs clean;
      a 500-visibility fix came out of this pass)
- [x] All tickets T01–T09 are ✅

## Deviations & notes

- **Smoke script is self-sufficient**: builds `dist/` if missing, bundles
  the migration/run entries with esbuild, applies migrations against a
  temp `DATABASE_URL` (the web entrypoint deliberately does not
  auto-migrate), pins/generates the bootstrap join code, and also accepts
  an external target: `scripts/smoke.sh <BASE_URL> <JOIN_CODE>` for the
  compose stack.
- **Fix-budget items** (module-local fixes, in this branch):
  - fix(T03): `jsonError` logs unhandled (500) errors server-side — they
    were invisible and cost real debugging time in this pass.
  - fix(T01): the settings bootstrap's bare catch swallowed real insert
    errors (it masked a container ownership issue below) — now only the
    UNIQUE-race is absorbed; anything else is logged + rethrown. (T04
    already hardened setRotation/setLastRotatedWeek to bootstrap the row.)
  - fix(T08): the compose migrate entrypoint chowns the data dir AFTER
    migrations (root-created DB files were readonly for `node`), and the
    bootstrap join code is passed to BOTH web and jobs containers (the
    jobs process bootstraps settings first via advanceRotation — a
    missing env there produced a random code that defeated web's).
- **Docker smoke note**: `docker compose down -v` does not touch the
  `./data` bind mount — pristine-stack runs need `rm -rf data`.
- **Second rendered-page pass** (owner reported a blank `/admin`; smoke
  gained page-content checks to pin each of these):
  - fix(T06): `.astro` templates must use lazy ternaries — `index.astro`
    referenced `myRating`/`RatingWidget` without defining them (the block
    only rendered for rated albums, so every logged-in view of a rated
    week → 500 "myRating is not defined").
  - fix(T06): `AlbumEmbed.astro`'s `<Switch>/<Match>` arms were eager slot
    strings that `<Switch>` dropped — no embed (or placeholder) ever
    rendered; converted to a lazy ternary.
  - fix(T07): `admin.astro` wrapped its whole body in `<Switch>/<Match>` —
    the admin page rendered 100% blank (no arms, no islands, not even the
    no-access arm); converted to lazy ternaries so the four islands
    hydrate again.
  - fix(T04): `statsForAlbums` only returned rows for albums with
    ratings, so the "unrated" state read as data loss — fresh picks made
    `/albums/{id}` serve "Album not found" (with 404 status) and the
    dashboard's featured section stuck on "nothing submitted yet". It now
    LEFT JOINs (`albums`→`ratings`) and returns `{avgScore: null,
    ratingCount: 0}` for any existing album; the repo test's contract was
    updated accordingly.

## Out of scope

New features (write a new ticket instead), CI, monitoring infrastructure.
