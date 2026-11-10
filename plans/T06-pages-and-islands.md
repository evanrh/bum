# T06 — Pages & islands

Status: ⬜
Depends on: T01–T04

## Goal

Turn the backend into the actual app: dashboard, submit flow, history, and
album detail — server-rendered Astro pages with React islands for
interactive parts, Tailwind throughout. Includes polished login/signup
islands replacing T03's minimal forms.

## Design language (keep consistent)

Dark zinc palette already established in `src/layouts/Base.astro`:
`bg-zinc-950` page, `rounded-xl border border-zinc-800 bg-zinc-900` cards,
`text-zinc-400` for secondary text, amber-ish accent for the weekly
highlight. Visible focus rings (`focus-visible:ring-2 ring-amber-400`),
semantic labels, mobile-first single column, max-width 3xl. Extend
`Base.astro` with a contextual nav (dashboard / albums / submit when
eligible / admin for admins / user menu incl. logout) — logout via a small
form POST to `/api/logout`.

## Pages

### 1. `/` dashboard

Server-rendered from `currentTurn` + albums/ratings repos:

- **Weekly banner**: "Week of {weekStart} — {picker}'s turn to pick" with
  the deadline (`endsAt`) and an island countdown. If the picker is *you*:
  stronger styling + link to `/submit`. If an album already exists for
  this week: switch the banner to "submitted by {name} on {date}".
- **Current album card** (the week's album, or the newest submitted): `AlbumEmbed.astro`, cover, title/artist/year, submitter, note, average
  score with half-star display, and — when viewing user has rated — their
  score highlighted; otherwise an inline `RatingWidget`.
- **Recent activity** list (last ~20 submissions + ratings merged, from
  repos; timestamps relative).
- **Mini leaderboard**: top 5 albums by `avg_score` (rating_count shown;
  ties by fewer ratings first). Link to full list.
- Logged-out visitors see everything read-only with a login prompt.

### 2. `/submit`

Only reachable in your week (404-to-a-friendly "not your week" page
otherwise; server checks `currentTurn`). Island `SubmitForm.tsx`: title,
artist, year, note, Spotify URL, YouTube URL, live client-side validation
mirroring Zod (share the Zod schemas from T04 by importing them into the
island), optimistic submit → redirect to the new album page. After
submission the endpoint rejects dupes — surface the 409 as "already
submitted this week".

### 3. `/albums`

- List of all albums with `AlbumCard.astro` (cover thumb, title,
  submitter, week, avg score + count).
- Filters: by submitter (dropdown in a `<details>` or inline chips),
  sort toggle newest/avg (island `AlbumFilters.tsx` pushing query params,
  server re-renders — no client fetching needed).
- Pagination 50/page.

### 4. `/albums/[id]`

- Full `AlbumEmbed`, all metadata, submitter note.
- **Ratings section**: every member's score (half-star row + numeric),
  comment, date; your own rating editable (island `RatingWidget` in edit
  mode) and deletable.
- Averages + count summary at top.

### 5. `/login` + `/signup` (replace T03's plain forms)

Islands `LoginForm.tsx` / `SignupForm.tsx`: same endpoints, inline field
errors (map the `{error}` payloads), disabled-during-submit UX, post-login
redirect to `/`. Signup includes the join-code field with a hint
("ask an admin for the club code").

## Islands (React) — under `src/components/islands/`

- `RatingWidget.tsx` — props `{albumId, initialScore?, initialComment?}`;
  half-star input (10 click segments over 5 stars, aria-labels like
  "3.5 stars", keyboard accessible), 240-char comment box, save →
  `PUT /api/ratings`, delete link. Optimistic UI with optimistic-error
  rollback.
- `SubmitForm.tsx`, `LoginForm.tsx`, `SignupForm.tsx` as above.
- `Countdown.tsx` — ticks to a server-provided ISO deadline each minute;
  renders "3d 14h" style static text as fallback for `client:only` gaps.
- `AlbumFilters.tsx` — filters are URL-state; the island just updates
  location. Keep it dependency-free.

Use `client:visible` for below-the-fold widgets, `client:load` for the
submit form. Add a `StarDisplay.astro` (static) for read-only half-star
rendering — one source of truth for the visual scale, used by cards and
album pages.

## Tests

- `test/ui/RatingWidget.test.tsx` — RTL: (jsdom pragma at top) render, click
  the 7th segment → shows 3.5 → PUT payload `{score: 7}`; initial rating
  renders selected; delete → confirm → DELETE; API 400 → inline error,
  state rolled back; double-press guard.
- `test/ui/SubmitForm.test.tsx` — validation errors per field; valid input
  → POST and success; 409 → friendly duplicate message; 403 → "not your
  week" message.
- `test/ui/LoginForm.test.tsx` — submit → POST; 401 → inline error; 429 →
  rate-limit message.
- StarDisplay/RatingWidget visual: assert the halves render via classes
  (no screenshot testing needed).
- Server pages: not unit-tested here (T09 covers the running flows); keep
  page frontmatter logic thin by pushing work into `src/lib` helpers that
  are tested where reused.

## Acceptance criteria

- [ ] Full member journey by hand on `npm run dev`: login → dashboard
      shows the week + picker → submit in turn → rate → history reflects
- [ ] Logged-out state is fully readable; nav auth-state correct
- [ ] All islands keyboard-reachable; forms usable without JS (T03's
      plain-form endpoints still accept them where feasible — document
      which flows degrade gracefully)
- [ ] `npm test` green incl. island tests; build clean

## Out of scope

Admin panel (T07), docker (T08), seeds beyond T01's.
