# T10 — OpenGraph embeds (issue #31)

Status: ⬜
Depends on: — (main page + layout exist; T06 ✓)
Issue: https://github.com/evanrh/bum/issues/31 — branch
`feat/31-opengraph-embeds`, commits `feat(#31): …` (post-launch
convention: T-number in `plans/`, issue number on branches/commits).

## Goal

Sharing `/` on Discord (primary), Facebook/messengers, etc. must unfurl
an embed: thumbnail, title, and a description reflecting the live state
of the club. Today `src/layouts/Base.astro`'s head is
charset/viewport/title only, and the app has no public-origin source:
the node adapter rewrites request URLs to host-less URLs (the issue
#16 story in `astro.config.mjs`), so `Astro.url`/`request.url` **origins
cannot be trusted** — pathname is fine, origin is not.

Decisions locked with the owner in planning (2026-11-21):

| Decision | Choice |
|---|---|
| Embed content | Dynamic — week-aware description; featured album's cover art as the image when one resolved |
| Fallback image | The site's favicon (one simple PNG mark) doubles as the fallback `og:image` |
| Origin source | `site:` in astro.config sourced from a **build-time** `SITE_URL` env; **the build fails when it's missing**; Docker passes it in as a build ARG (baked into the image — changing it = rebuild) |

## Deliverables

### 1. Build-time site origin — `astro.config.mjs`

- Resolve `SITE_URL` at config load: `process.env.SITE_URL` first, then
  Vite's `loadEnv(process.env.NODE_ENV ?? '', process.cwd(),
  'SITE_URL')` over the project's `.env`/`.env.local` (vite 6 ships with
  astro) so local `npm run dev` / `npm run build` honor a git-ignored
  `.env` as well as an exported shell var.
- Throw a clear `[bum] SITE_URL is required …` error when it is
  missing, unparseable as a URL, or not http(s); otherwise set
  `site: url` in the `defineConfig` object.
- Consequence (owner-accepted): `SITE_URL` is required for dev *and*
  build everywhere — the PR-gate's `npm run build` needs it in the
  environment from now on. `.env.example` + README document it (§7).

### 2. Docker build ARG — `Dockerfile`, `docker-compose.yml`

- Dockerfile: in the **build** stage only, before `RUN npm run build`:
  `ARG SITE_URL` + `ENV SITE_URL=$SITE_URL`. Runtime stage unchanged
  (the origin is baked into `dist/`; no service needs it at runtime).
- `docker-compose.yml`: hoist the four identical `build:` entries onto
  one definition with a YAML extension anchor so the arg is declared
  once:

  ```yaml
  x-build: &build
    context: .
    args:
      SITE_URL: "${SITE_URL:?SITE_URL is required — copy .env.example to .env (it is baked into the image for OG links)}"
  services:
    migrate:
      build: *build
      # …
  ```

  Compose's `${VAR:?message}` substitution makes `docker compose
  build`/`up` fail loudly before any image build work; the astro.config
  throw from §1 is the in-build backstop.
- Plain single-container alt (README §Docker): `docker build
  --build-arg SITE_URL=… .`

### 3. Helpers — `src/lib/opengraph.ts` (pure, no astro imports)

- `joinUrl(origin: string, path: string): string` — absolute URL join;
  throws on a malformed origin (defensive — §1 makes it impossible in
  practice).
- `ogDescription(input): string` — the embed blurb, hard-capped at 250
  chars (Discord truncates near ~350; leaves headroom), in order:
  1. `featured` album present →
     `{featured.weekStart === summary.week ? \`Week of ${week} — \` : ''}“{title}” by {artist}, picked by {displayName}.`,
     plus — only when `ratingCount > 0` — ` {scoreStars(avgScore)}
     from {ratingCount} ratings.` (star units per issue #28: never
     the raw 1–10 stored value in user-facing numbers)
  2. else `pickerName` exists → `Week of {week} — {pickerName}'s turn
     to pick.`
  3. else the static fallback: `A weekly album review club: one pick
     each week, everyone rates it.`
  Long titles/artists are truncated with an ellipsis at the cap.
- `ogImage({ coverUrl, origin }): string` — `coverUrl` when present
  (Spotify `/i.scdn.co` and `i.ytimg.com` URLs are already absolute
  https usable as-is), else `joinUrl(origin, '/icon.png')`.

### 4. Head markup — `src/layouts/Base.astro`

- Props gain an optional `og` object (`description?`, `image?`,
  `imageAlt?`, `imageWidth?`, `imageHeight?`); `og:title` mirrors the
  existing `title` prop; defaults are the static blurb + `/icon.png`.
- Absolute URLs come **only** from `Astro.site` (guaranteed by §1 —
  typed nullable, so guard with an explicit throw naming the config;
  never read `Astro.url`'s origin). `og:url` =
  `new URL(Astro.url.pathname, Astro.site)` — pathname only, query
  string stripped.
- Tags rendered on every page: `og:type=website`, `og:site_name=Bum`,
  `og:title`, `og:description`, `og:url`, `og:image` (always absolute)
  with `og:image:width`/`og:image:height`/`og:image:alt` for the static
  default only (dimensions unknown for dynamic covers); an explicit
  relative `og:image` value from a caller is resolved to absolute
  before render. Plus: `theme-color` `#18181b` (zinc-950);
  `<link rel="icon" type="image/png">` + `apple-touch-icon` to
  `/icon.png` (relative hrefs are fine for browsers); a minimal twitter
  mirror reusing the same values (`twitter:card=summary_large_image`,
  `twitter:title`, `twitter:description`, `twitter:image`) — 4 lines,
  keeps X unfurls correct for free.

### 5. Main-page wiring — `src/pages/index.astro`

- Pass the dynamic values from data the page already loads: `og={{
  description: ogDescription({ week: summary.week, pickerName:
  summary.pickerName, featured: featured ? { weekStart:
  featured.weekStart, title: featured.title, artist: featured.artist,
  submitterName: featuredSubmitter?.displayName ?? '', avgScore:
  featuredAvg, ratingCount: featuredStats?.ratingCount ?? 0 } : null }),
  image: featured?.coverUrl ?? undefined }}` — and that's it: `og:title`
  stays the page title, and when no cover resolved the Base default
  (`/icon.png`) applies.
- Every other page keeps Base defaults until a later ticket opts in.

### 6. Icon asset — `public/icon.png` + `scripts/make-icon.ts`

- 512 × 512 PNG, flat and simple: dark charcoal (`#18181b`)
  rounded-square background, amber (`#f59e0b`) vinyl-record ring mark
  with a cream center label (optionally a small lowercase `b`),
  legible at 32 px. Meets Discord's og:image floor (≥ 200×200, ≤ 8 MB,
  PNG/JPG/WEBP — no SVG).
- Generated reproducibly with **sharp** (already a dependency): a small
  one-shot `scripts/make-icon.ts` renders an inline SVG to
  `public/icon.png` (`node scripts/make-icon.ts`); commit both the
  script and the PNG. The owner can replace the PNG with a hand-made
  one any time — the script remains the documented generator.
  - 2026-11-21 planning note: the agent's image-model draft generation
    failed (`invalid credential`), so the asset is specified by design +
    produced deterministically with sharp instead. Spec unchanged.

### 7. Docs

- `.env.example`: document `SITE_URL` (e.g. `SITE_URL=https://bum.example.com`,
  local default `http://localhost:4321`) — **required for build/dev**.
- README: Quickstart gains `cp .env.example .env` **before**
  build/dev; Docker section notes the required build arg (plain-docker
  alt: `--build-arg`); Troubleshooting gains a row for the new build
  failure message ("SITE_URL is required").

### 8. Tests — `test/lib/opengraph.test.ts`

- `joinUrl`: origin with/without trailing slash, path with/without
  leading slash, malformed origin throws.
- `ogDescription`: pinned matrix per §3 (this week's album with and
  without ratings, an older featured album → no week prefix, pending
  week → picker line, empty rotation → static blurb, truncation cap
  incl. long CJK-safe input).
- `ogImage`: cover present → returned unchanged; null → origin-joined
  `/icon.png`; relative override → absolutized.
- No `.astro` page-render tests (matches repo style); the head markup
  itself is verified by the curl smoke in the acceptance list.

## Acceptance criteria

- [ ] `SITE_URL` unset → `npm run build` fails with the documented
      message; set → build green; `npm run dev` behaves the same.
- [ ] `docker compose build` with `SITE_URL` unset (and unset in
      `.env`) fails at compose substitution with the documented
      message; set → all four services build/boot unchanged.
- [ ] `curl -s http://localhost:4321/` against a built server shows the
      full OG + twitter set, favicon links, and `theme-color`;
      `og:url`/`og:image` are absolute and rooted at `SITE_URL`; with a
      cover-bearing album featured `og:image` is the album's cover URL,
      otherwise `/icon.png`.
- [ ] Discord unfurl verified live (paste into a DM): thumbnail, title,
      description render as specced.
- [ ] `npm test`, `npm run test:coverage` (thresholds include the new
      `src/lib/opengraph.ts`), `npm run typecheck`, and
      `npm run build` all green.

## Discord operational notes (owner reference, no code)

- Discord caches unfurls per URL: after content/image changes the old
  embed can persist until cache expiry — changing the URL (or adding a
  query string) forces a re-unfurl.
- Discord renders a big preview only for suitably wide (~1.91:1) images;
  square images (the 512×512 icon, album covers) show as large square
  thumbnails — expected behavior, no action.
- `og:description` truncates around ~350 chars; we target ≤ 250.

## Out of scope

- Per-album OG tags (each album page unfurling its own cover/average —
  §4's groundwork makes that a small follow-up).
- sitemap/robots.txt, JSON-LD, RSS/Atom.
- Dynamic og:image rendering with the build process, cache-busting
  tooling, `theme-color` theming beyond the single default.

## Deviations & notes

- (append during implementation)
