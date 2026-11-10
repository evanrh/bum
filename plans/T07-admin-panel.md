# T07 — Admin panel

Status: ⬜
Depends on: T01–T05

## Goal

The admin surface: user management, rotation control (order, epoch,
schedule), join-code rotation + joining toggle, skipped-turns history, and
the **mid-week admin skip**. All admin actions go through
`/api/admin/*` endpoints guarded by `requireAdmin`.

## Endpoints (all Zod-validated, all JSON `403` for non-admins)

- `GET /api/admin/users` — full user list (id, username, display_name,
  is_admin, is_active, rotation_order, joined_at, submission/rating
  counts).
- `POST /api/admin/users/{id}` — body `{action: 'promote' | 'demote' |
  'activate' | 'deactivate' | 'reset_password', password?}`. Guard:
  demoting yourself is rejected (409) if you'd be the last admin; count
  admins before applying.
- `POST /api/admin/rotation/order` — body `{userIds: number[]}` full
  ordering of active members (validates same set); normalizes
  `rotation_order` to 1..n for actives, leaves inactive rows untouched.
- `POST /api/admin/rotation/settings` — body `{rotation_epoch?,
  week_start_day?, week_start_hour?, timezone?, group_name?}`. Validate
  epoch is an ISO date (+normalize via T02), timezone via
  `Intl.supportedValuesOf`/`Intl.DateTimeFormat` probe (400 otherwise),
  day 0–6, hour 0–23.
- `POST /api/admin/rotation/skip` — the headline feature:
  1. Only meaningful for the current week; compute `currentTurn`.
  2. If a `skipped_turns` row already exists for (week, picker) → 409
     "this week's skip was already exercised" (also drives the disabled
     button).
  3. Otherwise, in one transaction: `rotation_offset += 1` (via settings
     repo update) and `skippedTurns.record(week, picker, 'admin')`
     (record-first ordering inside the txn; roll back both on failure).
  4. If the picker already submitted this week → still allowed; response
     carries `"warning": "N submitted an album this week; it was not
     deleted"` and the UI shows it.
  5. Respond with the **new** picker (recomputed) and new offset.
- `POST /api/admin/join-code` — regenerate via the settings repo →
  response `{join_code}` (plaintext shown exactly once; also logged to
  console as T01 does).
- `POST /api/admin/joining` — `{enabled: boolean}` toggles
  `joining_enabled`.
- `GET /api/admin/skips?limit=50` — skipped turns history (joined with
  display names; kind + week).

## Page — `/admin`

Single page, server-rendered sections (admin-only route guard; non-admins
get 404-style "no access" page, not a naked 403 JSON).

- **Users** — table with per-row actions (promote/demote, deactivate/
  activate). Island `AdminUsers.tsx` calling the endpoints; optimistic
  update, error toast row. Deactivation explains consequences inline
  ("loses login; history stays").
- **Rotation** — `AdminRotation.tsx`: ordered list of active members with
  ▲▼ buttons → batched order save (whole array on each move); form for
  epoch/day/hour/timezone/group name with a reset-to-loaded button; a
  warning line when changing epoch that it shifts the schedule for
  everyone immediately.
- **Weekly controls** — `AdminSkip.tsx`: shows current picker + week,
  the Skip button (disabled server-state prop `alreadySkipped`), a
  confirm dialog ("burns {name}'s turn; they'll pick again after the
  current cycle"), and the warning display when an album exists.
- **Join code** — `AdminJoinCode.tsx`: masked current state ("set,
  rotated {date}"), toggles joining, regenerate button (confirms),
  displays the fresh code once in a copyable field with a "won't be
  shown again" notice.
- **Skips** — server-rendered history table (no island needed).

## Tests

- `test/api/admin.test.ts` — full matrix, calling handlers with fixture
  DBs:
  - every endpoint: anonymous 401, member 403, admin ok
  - users: promote/demote/activate/deactivate round trips; demoting the
    last admin → 409; reset_password sets a hash that verifies; counts
    in GET are right
  - rotation: order update with a wrong id set → 400; epoch normalization
    (Wednesday epoch → Monday); bad timezone → 400; settings change is
    visible to `currentTurn` immediately
  - **skip semantics** (the critical block): seed 3 members; admin skip
    in week 0 → offset 1, `skipped_turns('admin')`, new picker = member 2;
    second skip same week → 409; skip with existing submitter → response
    warning + album untouched; next week's picker sequence reflects the
    burn (asserts against T02's expected-cycle behavior); auto+admin
    interplay: run `reconcile` after an admin skip → no duplicate row
  - join code: rotate → old fails `verifyJoinCode`, new passes; response
    plaintext matches; joining toggle blocks `/api/signup`
- `test/ui/AdminSkip.test.tsx` — disabled state from prop; confirm flow
  calls POST; 409 → friendly message; warning rendering.
- `test/ui/AdminRotation.test.tsx` — move up/down produces correct array
  payloads.

## Acceptance criteria

- [ ] Admin journey by hand: rotate join code → (new member signs up) →
      reorder → skip current picker → new picker sees the shift → skip
      blocked second time
- [ ] Last-admin protection enforced; deactivated member cannot log in
      (T03) and their turn is passed over via the member-list change
- [ ] Non-admins receive 403/404 everywhere on admin surface
- [ ] `npm test` / coverage green

## Out of scope

Deleting albums from the admin page — expose it on the album detail page
(admin-only buttons) posting to an `/api/albums/{id}/delete`-style
admin guard (add the endpoint here; reuse repo delete incl. cascade).
