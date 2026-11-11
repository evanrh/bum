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

# 4. the admin (queue head) submits with a real Spotify URL --------------------
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/albums" -d '{"title":"Kind of Blue","artist":"Miles Davis","year":1959,"spotify_url":"https://open.spotify.com/album/1weenld61qoidwYuZ1GESA"}')"
expect_status "$status" 201 "admin submits the first pick"
ALBUM_ID="$(extract_id)" || die "no album id in the response"
[ -n "$ALBUM_ID" ] || die "no album id after admin submission"

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

# 7. admin: settings + join-code lifecycle --------------------------------------
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/admin/rotation/settings" -d '{"group_name":"Smoke Club"}')"
expect_status "$status" 200 "admin updates the group name"
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/admin/join-code")"
expect_status "$status" 200 "admin rotates the join code"
NEW_CODE="$(sed -n 's/.*"join_code":"\([^"]*\)".*/\1/p' "$TMP_OUT")"
[ -n "$NEW_CODE" ] || die "no plaintext join code in the rotation response"
status="$(post -X POST "$BASE_URL/api/signup" -d '{"join_code":"'"$JOIN_CODE"'","username":"oldcode","display_name":"Old","password":"old-pass-12345"}')"
expect_status "$status" 401 "the old join code now fails signup"
status="$(post -X POST "$BASE_URL/api/signup" -c "$JAR_E" -d '{"join_code":"'"$NEW_CODE"'","username":"emember","display_name":"E Member","password":"em-pass-12345"}')"
expect_status "$status" 201 "a member joins with the fresh code"

# 8. admin deletes the week's album, then skips → B picks the remainder --------
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/albums/$ALBUM_ID/delete")"
expect_status "$status" 204 "admin deletes the week's album"
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/admin/rotation/skip")"
expect_status "$status" 200 "admin skip moves the picker"
status="$(post -b "$JAR_B" -X POST "$BASE_URL/api/albums" -d '{"title":"Remainder Pick","artist":"B Member","youtube_url":"https://youtube.com/watch?v=f27gQXSnU0M"}')"
expect_status "$status" 201 "B (now the picker) submits"

# 9. logout + anonymous access ---------------------------------------------------
status="$(post -b "$JAR_A" -X POST "$BASE_URL/api/logout")"
expect_status "$status" 204 "admin logs out"
status="$(get "$BASE_URL/api/albums")"
expect_status "$status" 200 "anonymous read stays public"
status="$(post -X PUT "$BASE_URL/api/ratings" -d '{"album_id":"anything","score":5}')"
expect_status "$status" 401 "anonymous mutation → 401"

say "ALL CHECKS PASSED ($BASE_URL)"
