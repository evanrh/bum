#!/usr/bin/env bash
# End-to-end smoke for Bum — the full member + admin journey over HTTP.
#
# Usage:
#   scripts/smoke.sh                        # boots the built server itself
#   scripts/smoke.sh http://host:port CODE  # run against an external target
#                                           # (dev server or the compose stack;
#                                           # CODE = its bootstrap join code)
# VERBOSE=1 prints response bodies on failure.
set -euo pipefail

BASE_URL="${1:-}"
JOIN_CODE="${2:-}"
SERVER_PID=""
LOG_FILE=""
FAILED=""

say() { echo "smoke: $*"; }
die() {
  echo "smoke: ✗ $*" >&2
  if [ "${VERBOSE:-0}" = "1" ] && [ -f "${LAST_BODY:-}" ]; then
    echo "--- last response ---" >&2
    cat "$LAST_BODY" >&2
  fi
  exit 1
}
trap '[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true' EXIT

# --- boot the server when no target is given ---------------------------------
if [ -z "$BASE_URL" ]; then
  [ -f dist/server/entry.mjs ] || { say "building…"; npm run build >/dev/null; }
  # The scripts' DB must be migrated first — the web entrypoint does not
  # apply migrations (only the jobs/migrate entries do).
  if [ ! -f dist/jobs/migrate.mjs ]; then
    say "bundling dist/jobs entries (needed for the migration step)…"
    ./node_modules/.bin/esbuild src/db/migrate.ts --bundle --platform=node --format=esm --packages=external --sourcemap --outfile=dist/jobs/migrate.mjs
    ./node_modules/.bin/esbuild src/jobs/run.ts --bundle --platform=node --format=esm --packages=external --sourcemap --outfile=dist/jobs/run.mjs
  fi
  if [ -z "$JOIN_CODE" ]; then
    JOIN_CODE="SMOKE$(date +%s | tail -c 6)"
  fi
  LOG_FILE="$(mktemp -t bum-smoke-log-XXXXXX)"
  LAST_BODY="$LOG_FILE"
  SMOKE_DB="$(mktemp -t bum-smoke-db-XXXXXX).db"
  DATABASE_URL="$SMOKE_DB" node dist/jobs/migrate.mjs >/dev/null
  # Runtime OG links need a SITE_URL even for local smoke (issue #39).
  SITE_URL="${SITE_URL:-http://127.0.0.1:4399}" \
  DATABASE_URL="$SMOKE_DB" \
    BOOTSTRAP_JOIN_CODE="$JOIN_CODE" \
    HOST=127.0.0.1 PORT=4399 \
    node dist/server/entry.mjs >"$LOG_FILE" 2>&1 &
  SERVER_PID=$!
  BASE_URL="http://127.0.0.1:4399"
  for _ in $(seq 1 30); do
    curl -s -o /dev/null "$BASE_URL/api/health" && break
    sleep 1
  done
  say "server up (pid $SERVER_PID) with pinned join code"
fi

H="origin: $BASE_URL"
CT="content-type: application/json"
JAR_A="$(mktemp -t bum-smoke-jarA-XXXXXX)"
JAR_B="$(mktemp -t bum-smoke-jarB-XXXXXX)"
JAR_C="$(mktemp -t bum-smoke-jarC-XXXXXX)"
JAR_D="$(mktemp -t bum-smoke-jarD-XXXXXX)"
JAR_E="$(mktemp -t bum-smoke-jarE-XXXXXX)"
TMP_OUT="$(mktemp -t bum-smoke-out-XXXXXX)"
LAST_BODY="$TMP_OUT"

post() { curl -s -o "$TMP_OUT" -w "%{http_code}" -H "$H" -H "$CT" "$@"; }
get() { curl -s -o "$TMP_OUT" -w "%{http_code}" "$@"; }
expect_status() {
  local actual="$1" expected="$2" what="$3"
  if [ "$actual" != "$expected" ]; then
    die "$what — expected $expected, got $actual (body in $TMP_OUT)"
  fi
  say "✓ $what ($actual)"
}
extract_id() { sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$TMP_OUT"; }

# 1+2. signup admin (the first user), then members B, C, D --------------------
PICKER_PW='smoke-pw-12345'
status="$(post -X POST "$BASE_URL/api/signup" -c "$JAR_A" -d '{"join_code":"'"$JOIN_CODE"'","username":"admin","display_name":"Smoke Admin","password":"'"$PICKER_PW"'"}')"
expect_status "$status" 201 "admin signup (first user → admin)"
status="$(post -X POST "$BASE_URL/api/signup" -c "$JAR_B" -d '{"join_code":"'"$JOIN_CODE"'","username":"bmember","display_name":"B Member","password":"'"$PICKER_PW"'"}')"
expect_status "$status" 201 "member B signup"
status="$(post -X POST "$BASE_URL/api/signup" -c "$JAR_C" -d '{"join_code":"'"$JOIN_CODE"'","username":"cmember","display_name":"C Member","password":"'"$PICKER_PW"'"}')"
expect_status "$status" 201 "member C signup"
status="$(post -X POST "$BASE_URL/api/signup" -c "$JAR_D" -d '{"join_code":"'"$JOIN_CODE"'","username":"dmember","display_name":"D Member","password":"'"$PICKER_PW"'"}')"
expect_status "$status" 201 "member D signup"

# 3. GET / is public and shows the club ----------------------------------------
status="$(get "$BASE_URL/")"
expect_status "$status" 200 "GET /"
grep -q "album review club" "$TMP_OUT" || die "GET / is missing the club name"
# Runtime OG links (issue #39): og:url must mint from the SITE_URL env.
grep -q 'og:url" content="http://127.0.0.1:4399/"' "$TMP_OUT" || die "og:url is not derived from the runtime SITE_URL"

# 4. the admin (queue head) submits with a real Spotify URL --------------------
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/albums" -d '{"title":"Kind of Blue","artist":"Miles Davis","year":1959,"spotify_url":"https://open.spotify.com/album/1weenld61qoidwYuZ1GESA"}')"
expect_status "$status" 201 "admin submits the first pick"
ALBUM_ID="$(extract_id)" || die "no album id in the response"
[ -n "$ALBUM_ID" ] || die "no album id after admin submission"

# 4b. page content: a fresh (unrated) pick renders everywhere ------------------
status="$(get "$BASE_URL/albums/$ALBUM_ID")"
expect_status "$status" 200 "GET /albums/{id} for the fresh pick"
grep -q "Kind of Blue" "$TMP_OUT" || die "album detail page hides an unrated album"
grep -q "open.spotify.com/embed" "$TMP_OUT" || die "AlbumEmbed swallowed the Spotify iframe"
status="$(get "$BASE_URL/")"
grep -q 'aria-label="featured album"' "$TMP_OUT" && grep -q "Kind of Blue" "$TMP_OUT" || die "dashboard does not feature the fresh pick"
say "✓ album detail + dashboard feature the fresh pick"

# 5. B and C rate it (7 + 10 → avg 8.5) ----------------------------------------
status="$(post -b "$JAR_B" -X PUT "$BASE_URL/api/ratings" -d '{"album_id":"'"$ALBUM_ID"'","score":7,"comment":"smoky"}')"
expect_status "$status" 200 "B rates 7"
status="$(post -b "$JAR_C" -X PUT "$BASE_URL/api/ratings" -d '{"album_id":"'"$ALBUM_ID"'","score":10,"comment":"perfect"}')"
expect_status "$status" 200 "C rates 10"
status="$(get "$BASE_URL/api/albums?sort=avg")"
grep -q '"avgScore":8.5' "$TMP_OUT" || {
  if [ "$VERBOSE" = "1" ]; then cat "$TMP_OUT" >&2; fi
  die "expected avgScore 8.5 in the album list"
}
say "✓ average is 8.5 via the API"

# 6. B cannot pick outside their turn; ratings upsert ---------------------------
status="$(post -b "$JAR_B" -X POST "$BASE_URL/api/albums" -d '{"title":"No","artist":"Nope"}')"
expect_status "$status" 403 "B submitting out of turn → 403"
status="$(post -b "$JAR_B" -X PUT "$BASE_URL/api/ratings" -d '{"album_id":"'"$ALBUM_ID"'","score":8}')"
expect_status "$status" 200 "B re-rates (upsert)"
status="$(get "$BASE_URL/api/albums")"
grep -q '"ratingCount":2' "$TMP_OUT" || die "rating count should stay 2 after the upsert"
say "✓ upsert keeps one rating row per member"

  # 6b. a member who rated sees their score on the dashboard (regression:
  # the featured block used to crash with an undefined myRating). Since #13
  # the widget renders read-only server-side — check its view-mode marker.
  status="$(get -b "$JAR_B" "$BASE_URL/")"
  grep -q "rating-readonly" "$TMP_OUT" || die "dashboard hides B's own rating"

# 7. admin: settings + join-code lifecycle --------------------------------------
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/admin/rotation/settings" -d '{"group_name":"Smoke Club"}')"
expect_status "$status" 200 "admin updates the group name"

# 7b. the admin page renders its sections (regression: once came out blank) ----
status="$(get -b "$JAR_A" "$BASE_URL/admin")"
expect_status "$status" 200 "GET /admin (admin session)"
grep -q "weekly controls" "$TMP_OUT" && grep -q "audit log" "$TMP_OUT" || die "admin page rendered blank"
status="$(get -b "$JAR_B" "$BASE_URL/admin")"
expect_status "$status" 404 "GET /admin (member session → 404-style no-access page)"
grep -q "club admins only" "$TMP_OUT" || die "member sees more than the no-access page"
say "✓ admin page renders (full for admins, no-access for members)"
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/admin/join-code")"
expect_status "$status" 200 "admin rotates the join code"
NEW_CODE="$(sed -n 's/.*"join_code":"\([^"]*\)".*/\1/p' "$TMP_OUT")"
[ -n "$NEW_CODE" ] || die "no plaintext join code in the rotation response"
status="$(post -X POST "$BASE_URL/api/signup" -d '{"join_code":"'"$JOIN_CODE"'","username":"oldcode","display_name":"Old","password":"old-pass-12345"}')"
expect_status "$status" 401 "the old join code now fails signup"
status="$(post -X POST "$BASE_URL/api/signup" -c "$JAR_E" -d '{"join_code":"'"$NEW_CODE"'","username":"emember","display_name":"E Member","password":"em-pass-12345"}')"
expect_status "$status" 201 "a member joins with the fresh code"

# 8. admin deletes the week's album, then skips → B picks the remainder --------
SKIP_OUT="$(mktemp -t bum-smoke-skip-XXXXXX)"
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/albums/$ALBUM_ID/delete")"
expect_status "$status" 204 "admin deletes the week's album"
skip_status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/admin/rotation/skip")"
expect_status "$skip_status" 200 "admin skip moves the picker"
cp "$TMP_OUT" "$SKIP_OUT"
status="$(post -b "$JAR_B" -X POST "$BASE_URL/api/albums" -d '{"title":"Remainder Pick","artist":"B Member","youtube_url":"https://youtube.com/watch?v=f27gQXSnU0M"}')"
expect_status "$status" 201 "B (now the picker) submits"

# 8b. arbitrary override (issue #17): name the LAST member of the queue as the
# picker — the queue must rotate so they lead, pre-head order behind the tail.
SKIP_QUEUE="$(grep -o '"queue":\[[^]]*\]' "$SKIP_OUT" | sed 's/"queue":\[//; s/\]//')"
OVERRIDE_TARGET="$(echo "$SKIP_QUEUE" | awk -F, '{print $NF}')"
[ -n "$OVERRIDE_TARGET" ] || die "could not read the skip response queue for the override step"
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/admin/rotation/select" -d '{"user_id":'"$OVERRIDE_TARGET"'}')"
expect_status "$status" 200 "admin overrides to an arbitrary member (issue #17)"
grep -q "\"picker\":{\"id\":$OVERRIDE_TARGET" "$TMP_OUT" || die "override did not set the requested picker as head"
EXPECTED_QUEUE="$OVERRIDE_TARGET,$(echo "$SKIP_QUEUE" | sed 's/,[^,]*$//')"
grep -q "\"queue\":\[$EXPECTED_QUEUE\]" "$TMP_OUT" || die "override rotated the order incorrectly (expected $EXPECTED_QUEUE)"

# 8c. member backlog (issue #18): queue two albums, reorder, toggle the
# auto-queue off, remove one. The advance-driven auto-submit is covered by
# the unit tests; the endpoints are the browser-reachable surface.
status="$(post -b "$JAR_B" -X POST "$BASE_URL/api/backlog" -d '{"title":"Backlog Alpha","artist":"Artist One"}')"
expect_status "$status" 201 "B queues Backlog Alpha"
FIRST_ID="$(extract_id)"
status="$(post -b "$JAR_B" -X POST "$BASE_URL/api/backlog" -d '{"title":"Backlog Beta","artist":"Artist Two"}')"
expect_status "$status" 201 "B queues Backlog Beta"
SECOND_ID="$(extract_id)"
status="$(post -b "$JAR_B" -X POST "$BASE_URL/api/backlog/order" -d '{"ids":["'"$SECOND_ID"'","'"$FIRST_ID"'"]}')"
expect_status "$status" 200 "B reorders the backlog (Beta first)"
status="$(get -b "$JAR_B" "$BASE_URL/api/backlog")"
grep -q "\"title\":\"Backlog Beta\"" "$TMP_OUT" || die "reordered backlog head is not Beta"
status="$(post -b "$JAR_B" -X POST "$BASE_URL/api/backlog/auto-queue" -d '{"enabled":false}')"
expect_status "$status" 200 "B disables auto-queueing (issue #18)"
grep -q '"autoBacklog":false' "$TMP_OUT" || die "auto-queue toggle did not report off"
status="$(post -b "$JAR_B" -X DELETE "$BASE_URL/api/backlog/$SECOND_ID")"
expect_status "$status" 204 "B removes a queued album"
status="$(get -b "$JAR_B" "$BASE_URL/api/backlog")"
grep -q '"title":"Backlog Alpha"' "$TMP_OUT" || die "remaining backlog item vanished"
grep -q 'Backlog Beta' "$TMP_OUT" && die "removed backlog item still listed"
status="$(get -b "$JAR_B" "$BASE_URL/backlog")"
grep -q "your queue" "$TMP_OUT" && grep -q "Backlog Alpha" "$TMP_OUT" || die "the backlog page does not render the member queue"
status="$(get "$BASE_URL/api/backlog")"
expect_status "$status" 401 "backlog is member-private (anonymous → 401)"

# 9. logout + anonymous access ---------------------------------------------------
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/logout")"
expect_status "$status" 204 "admin logs out"
status="$(get "$BASE_URL/api/albums")"
expect_status "$status" 200 "anonymous read stays public"
status="$(post -X PUT "$BASE_URL/api/ratings" -d '{"album_id":"anything","score":5}')"
expect_status "$status" 401 "anonymous mutation → 401"

# 10. browser-form regression (issue #16): real <form> posts are urlencoded and
# go through Astro's origin check — the JSON posts above bypass it. A login +
# logout in the exact shape the header buttons fire must still work.
status="$(curl -s -o "$TMP_OUT" -w "%{http_code}" -X POST "$BASE_URL/api/login" \
  -H "origin: $BASE_URL" -H "content-type: application/x-www-form-urlencoded" \
  -c "$JAR_B" --data-urlencode "username=bmember" --data-urlencode "password=$PICKER_PW")"
expect_status "$status" 303 "urlencoded login (browser form shape → redirect)"
status="$(curl -s -o "$TMP_OUT" -w "%{http_code}" -X POST "$BASE_URL/api/logout" \
  -H "origin: $BASE_URL" -H "content-type: application/x-www-form-urlencoded" \
  -b "$JAR_B")"
expect_status "$status" 303 "urlencoded logout (browser form shape, issue #16)"

say "ALL CHECKS PASSED ($BASE_URL)"
