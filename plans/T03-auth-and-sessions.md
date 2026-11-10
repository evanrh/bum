# T03 — Auth & sessions

Status: ⬜
Depends on: T01, T02

## Goal

Working authentication: join-code signup, username/password login, DB
sessions via a cookie, request middleware, permission helpers — plus
api endpoints and minimal, merely-functional auth pages (T06 restyles
them as React islands later).

## Deliverables

### 1. Disable Astro's built-in sessions

`astro.config.mjs`: add `session: false` at the top level (the node
adapter currently logs "Enabling sessions with filesystem storage" — that
must go). Our sessions live in an in-memory server-side store — login
writes, logout drops, a process restart clears everything (owner-approved).
If the exact config
key differs in the installed Astro version, locate the supported way and
note it in *Deviations & notes*.

### 2. Core logic

- `src/lib/errors.ts` — `ApiError(status, message)`; helper
  `jsonError(error)` → `Response` with `{ error }` JSON body. Every API
  endpoint returns errors this way (convention in `plans/README.md`).
- `src/lib/auth.ts` —
  - password hashing: bcryptjs, cost 12 (`hashPassword` / `verifyPassword`)
  - tokens: `generateSessionToken()` (32 random bytes, base64url),
    `hashToken(token)` (sha256 hex)
  - rate limiting: `RateLimiter` class with injectable `now()`; window 15
    min, 10 max; `attempt(key) -> ok | {retryableInMs}`; keys are
    `ip:username` for login and `ip` for signup; a module-level singleton
    for the HTTP layer (restart-resets-acceptable per conventions), a
    fresh instance for tests
  - cookie helpers: build/clear the `bum_session` cookie header
    (HttpOnly, SameSite=Lax, Path=/, Max-Age 30d, Secure only when the
    request URL is https)
- `src/lib/permissions.ts` — given `locals.user`:
  `requireUser(locals)` (throws 401 if missing),
  `requireActiveUser` (403 when deactivated),
  `requireAdmin` (401/403) — all throwing `ApiError`.

### 3. Middleware — `src/middleware.ts` (Astro middleware, project root of src/) which:

1. Reads the `bum_session` cookie, resolves the session in the in-memory
   store (keyed by the cookie token's sha256), drops expired entries,
   puts `user` on `Astro.locals` (typed via
   `src/env.d.ts`: `interface App.Locals { user: User | null }` — if the
   installed Astro prefers a different typing mechanism, use it and note
   it).
2. For mutating methods (POST/PUT/DELETE) on `/api/*`: if `Origin` or
   `Referer` header is present and its host differs from the request's
   `Host` → 403 before the endpoint runs.

### 4. Endpoints (Astro API routes, all validate with Zod)

- `POST /api/signup` — body `{ join_code, username, display_name,
  password }`. Rules: joining enabled (403 otherwise), join code verifies
  (401 on mismatch), username `^[A-Za-z0-9_-]{3,32}$` + display_name 1–64
  + password 8–128 (400), NOCASE duplicate username (409), rate limit
  (429). First user ever → `is_admin = 1`. Every signup appends the new
  user's id to the back of the rotation queue (settings repo from T02).
  Creates a session; 201 + `Set-Cookie`. Response body: safe user
  profile (never hash fields).
- `POST /api/login` — body `{ username, password }`. Rate limit per
  `ip:username` (429). Unknown username vs wrong password → identical 401
  ("invalid username or password") to avoid oracle. Deactivated → 403
  with a distinct message. 200 + cookie.
- `POST /api/logout` — auth required; drops the session from the store
  and clears the cookie; 204.

### 5. Pages (minimal HTML forms — T06 owns the polished React versions)

`src/pages/login.astro` and `src/pages/signup.astro`: plain server-
rendered `<form method="post">` posting to the endpoints above (no-JS
path must work), each with an inline error slot, and a cross-link. Keep
them short and unstyled beyond `Base.astro`.

## Tests — `test/lib/*` + `test/api/*`

- `test/lib/auth.test.ts` — hash/verify round trip (wrong password
  false); token shape/entropy; `RateLimiter` with a fake clock: 10 ok,
  11th blocked, window expiry unblocks; cookie header assertions
  (flags present/absent, Max-Age)
- `test/api/*.test.ts` — call the exported handlers directly with a
  minimal `{ request, locals }` context (handlers are pure
  Request→Response; no astro container needed). Cases:
  - signup: happy path sets cookie + 201; **first user is admin**;
    second isn't; case-insensitive duplicate → 409; bad/missing join
    code → 401; joining disabled → 403; each Zod failure → 400 with
    message; 11th signup from same IP → 429
  - login: ok; wrong password and unknown username produce byte-identical
    401 payloads; deactivated user → 403
  - middleware: injects user for a valid cookie (use a fixture DB through
    an exported `resolveUser(request, db)` helper so the logic is
    testable without Astro); expired-cookie drops the store entry;
    cross-origin POST with a mismatched Origin header → 403; GET with
    mismatched Origin → allowed
  - logout: removes row, clears cookie
- Permissions: anonymous/member/deactivated-member/admin matrix over the
  three helpers (throws ApiError with the right status).

## Acceptance criteria

- [ ] Built-in Astro sessions disabled (no "filesystem storage" log line in
      `npm run dev` output)
- [ ] All three endpoints work via `curl` with the cookie flow end to end
- [ ] First-user-is-admin enforced; join code gates signup and is
      rotatable via the settings repo (used by T07)
- [ ] Origin check active on all `/api/*` mutations
- [ ] Full permission matrix tested; `npm test` and test:coverage green

## Out of scope

"Who am I" UI, dashboard/profile pages, join code rotation UI (T07),
password reset/self-service email (none — lost password = admin re-invites
via join code; keep a `resetPassword(userId, newPassword)` repo function
for admins).
