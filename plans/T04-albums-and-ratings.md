# T04 — Albums & ratings

Status: ✅
Depends on: T01, T02, T03

## Goal

The core domain: submitting an album during your week, external URL
parsing (Spotify/YouTube), cover resolution, and ratings (half-star ints).
Backend + service logic, plus one small embed component. T06 builds the
full UI on top.

## Deliverables

### 1. Parsers — `src/lib/external.ts`

Per the locked spec in `plans/README.md`:

- `parseSpotifyAlbum(input: string): string` — accepts a full URL
  (`open.spotify.com/album/{id}` or `open.spotify.com/embed/album/{id}`,
  query strings allowed); returns the id; id pattern
  `[A-Za-z0-9]{10,64}`. Throws `ApiError(400, …)` on track/playlist/user
  URLs or garbage, with a message naming the accepted album-URL forms.
- `parseYouTubeVideo(input: string): string` — accepts
  `youtube.com/watch?v={id}` (+ any params), `youtu.be/{id}`,
  `music.youtube.com/watch?v={id}`, `youtube.com/embed/{id}`; id
  `[A-Za-z0-9_-]{11}`; a `list=` param **without** `v=` is a playlist →
  400 with guidance.
- `spotifyEmbedUrl(id)`, `youtubeEmbedUrl(id)` builders.
- `resolveCoverUrl(ids: {spotifyId?: string; youtubeId?: string}, fetch)`:
  spotify → GET `https://open.spotify.com/oembed/?url=https://open.spotify.com/album/{id}`
  use `thumbnail_url`; youtube-only → ytimg URL; nothing/failed → null.
  Timeout 5 s, any error → null (never throws). **Accept a fetch
  implementation parameter** so tests inject a stub.

### 2. Services

- `src/lib/albums.ts` —
  `submitAlbum(user, db, settingsRepo, input, {now, fetch})`:
  requireActiveUser; compute `currentTurn` via T02; empty queue →
  400 "no rotation defined"; if `pickerId !== user.id` → 403 "it's not
  your week"; if `albums.getByWeekStart` exists → 409 "an album was
  already submitted this week". Zod input: title 1–200, artist 1–200,
  `year` optional 1900–2100, `spotify_url`/`youtube_url` optional strings,
  `note` ≤ 1000. At least one of the two URLs **may** be empty (manual
  entry allowed); parse → store ids; resolve cover (best-effort); insert.
  Returns the row. Week attribution: `week_start` = the ISO Monday from
  `currentTurn`.
- `src/lib/ratings.ts` — `upsertRating(user, db, input)`:
  requireActiveUser; album must exist (404); Zod `score` int 1–10
  (= stars × 2), `comment` optional ≤ 2000; upsert via repo. Any member
  may rate **any** album anytime (locked). `deleteRating(user, db,
  albumId)`: own rating only, admins included (they use their own
  deletion right — same endpoint, same rule: only your own rows).

### 3. Endpoints

- `POST /api/albums` — submit form payload → 201 + album row (JSON).
  400/403/409 per service.
- `GET /api/albums?by=<userId>&sort=newest|avg&page=<n>&pageSize=50` —
  list with aggregates (T01 repo). 200 JSON `{items, total}`.
- `PUT /api/ratings` — body `{album_id, score, comment?}` upsert → 200;
  `DELETE /api/ratings?album_id=…` → 204. Permission/404 paths as above.

### 4. Component — `src/components/AlbumEmbed.astro`

Props: `{spotifyId?, youtubeId?, title}`. Renders the locked embed
iframes (Spotify compact 152px tall, YouTube 16:9 with
`youtube-nocookie`), `loading="lazy"`, `title` attributes for a11y.
If neither id → render a muted "no preview" card. Server-rendered; not an
island.

## Tests

- `test/lib/external.test.ts` — the full parser matrix:
  good desktop/mobile/embed/music URLs, uppercase/whitespace, query junk;
  spotify track/playlist/user rejections; youtube list-only rejection
  (with `v=` present → ok); too-short/long ids; non-URLs → 400.
  Embed URL builders frozen strings. Cover: stub fetch resolving the
  oEmbed JSON shape → `thumbnail_url` used; fetch throws/timeout → null;
  youtube-only → ytimg constant; neither → null.
- `test/lib/albums.test.ts` — fixture settings/users from T01/T02
  helpers: submission during a member's week → row with correct
  `week_start`; non-picker → 403 (message asserts it names the picker);
  duplicate week → 409; empty queue → 400; deactivated → 403; year=0 /
  note 1001 chars → 400; spotify+youtube both parsed; neither URL → ok;
  cover failure doesn't fail submission (offline fetch stub).
- `test/lib/ratings.test.ts` — upsert new vs edit (created_at preserved,
  updated_at bumped); score 0/11, comment 2001 → 400; unknown album →
  404; deleting someone else's → 403 even as admin; own → 204.
- API-level (`test/api/albums.test.ts`) — cookie-authenticated happy path
  (member A submits during A's week after seeding rotation state via the
  service layer), GET list shape incl. aggregates and `by=` filter.

## Acceptance criteria

- [x] A curl-driven flow works: login as a member → submit in their week →
      other member rates → album appears in `GET /api/albums` with correct
      avg (10 + 7 → `avgScore: 8.5`, `ratingCount: 2`, spotifyId parsed)
- [x] Parser matrix fully green; no third-party API keys anywhere
- [x] `npm test` / `npm run test:coverage` green (157 tests; coverage
      92.8/90.0/93.3/93.5, `external.ts` at 100%)

## Deviations & notes

- **2026-11-11 — settings repo hardening (discovered during integration):
  `setRotation` / `setLastRotatedWeek` now bootstrap the singleton row
  first.** A bare UPDATE against a fresh database silently no-ops (no row
  exists yet), so a rotation queue set before any `getSettings()` was
  lost without a trace. Both setters now call `getSettings(db)` before
  updating — idempotent for the existing flows.

## Out of scope

Any page/UI beyond `AlbumEmbed.astro` (T06), admin deletion (T07),
notifications.
