# T07 — Admin panel

Status: ⬜
Depends on: T01–T05

## Goal

The admin surface: user management, rotation control (queue order +
manual skip), join-code rotation + joining toggle, audit-log history, and
the **mid-week admin skip** (a manual pop/push of the queue). All admin
actions go through `/api/admin/*` endpoints guarded by `requireAdmin`.

## Endpoints (all Zod-validated, all JSON `403` for non-admins)

- `GET /api/admin/users` — full user list (id, username, display_name,
  is_admin, is_active, joined_at, submission/rating counts, and each
  member's queue position if present in `settings.rotation`).
- `POST /api/admin/users/{id}` — body `{action: 'promote' | 'demote' |
  'activate' | 'deactivate' | 'reset_password', password?}`. Guard:
  demoting yourself is rejected (409) if you'd be the last admin; count
  admins before applying.
- `POST /api/admin/rotation/order` — body `{queue: number[]}` — the full
  rotation queue: must be exactly the set of active member ids, no
  duplicates (400 otherwise); stored verbatim; the head becomes the
  current picker immediately.
- `POST /api/admin/rotation/settings` — body `{group_name?}` (the
  schedule fields are gone — weeks are fixed Mondays, US Eastern).
- `POST /api/admin/rotation/skip` — the headline feature: one manual
  pop/push of the rotation queue.
  1. Empty queue → 409 "nothing to skip".
  2. Otherwise, in one transaction: `rotateQueue` (current head → back
     of the queue) and an `audit_log` row (actor = the admin, action
     `queue.override`, detail naming who was moved); audit-first
     ordering inside the txn; roll back both on failure. No dedupe —
     repeated calls rotate again, each logged.
  3. If the picker already submitted this week → still allowed; response
     carries `"warning": "N submitted an album this week; it was not
     deleted"` and the UI shows it (the new head cannot also submit this
     week — the submit path 409s).
  4. Respond with the new queue and the new picker.
- `POST /api/admin/join-code` — regenerate via the settings repo →
  response `{join_code}` (plaintext shown exactly once; also logged to
  console as T01 does).
- `POST /api/admin/joining` — `{enabled: boolean}` toggles
  `joining_enabled`.
- `GET /api/admin/audit?limit=50` — audit log history (joined with the
  actor's display name; a null actor renders as "system"; shows action +
  detail + time).

## Page — `/admin`

Single page, server-rendered sections (admin-only route guard; non-admins
get 404-style "no access" page, not a naked 403 JSON).

- **Users** — table with per-row actions (promote/demote, deactivate/
  activate). Island `AdminUsers.tsx` calling the endpoints; optimistic
  update, error toast row. Deactivation explains consequences inline
  ("loses login; history stays").
- **Rotation** — `AdminRotation.tsx`: ordered list of active members with
  ▲▼ buttons → batched save of the whole queue on each move.
- **Weekly controls** — `AdminSkip.tsx`: shows current picker + week,
  the Skip button (always enabled — each press is one rotation step
  logged to the audit log), a confirm dialog ("moves {name} to the back;
  {nextName} picks for the rest of this week"), and the warning display
  when an album exists.
- **Join code** — `AdminJoinCode.tsx`: masked current state ("set,
  rotated {date}"), toggles joining, regenerate button (confirms),
  displays the fresh code once in a copyable field with a "won't be
  shown again" notice.
- **Audit** — server-rendered history table of `audit_log` (no island
  needed).

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
    in week 0 → head moves to the back, new picker = member 2, one
    `audit_log` row (action `queue.override`, actor = admin); a second
    skip rotates again (no 409, second audit row); skip with existing
    submitter → response warning + album untouched; queue-order update
    with a wrong id set → 400
  - join code: rotate → old fails `verifyJoinCode`, new passes; response
    plaintext matches; joining toggle blocks `/api/signup`
- `test/ui/AdminSkip.test.tsx` — always-enabled button (no disabled
  prop); confirm flow calls POST; warning rendering.
- `test/ui/AdminRotation.test.tsx` — move up/down produces correct array
  payloads.

## Acceptance criteria

- [ ] Admin journey by hand: rotate join code → (new member signs up,
      appended to the queue) → reorder → skip current picker → new
      picker sees the shift → skip again rotates further; audit rows
      visible
- [ ] Last-admin protection enforced; deactivated member cannot log in
      (T03) and their turn is passed over via the member-list change
- [ ] Non-admins receive 403/404 everywhere on admin surface
- [ ] `npm test` / coverage green

## Out of scope

Deleting albums from the admin page — expose it on the album detail page
(admin-only buttons) posting to an `/api/albums/{id}/delete`-style
admin guard (add the endpoint here; reuse repo delete incl. cascade).
