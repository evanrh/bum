# syntax=docker/dockerfile:1

# ---- base ---------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- deps: full dependency tree (incl. dev) for the build stage ---------
# --ignore-scripts: every native package ships prebuilt binaries
# (better-sqlite3 even embeds them, but its v13 install script still
# shells out to node-gyp — which npm ci runs unconditionally, unlike
# npm install — and would demand a python/make/g++ toolchain for nothing
# that isn't already shipped, issue #48).
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --include=dev

# ---- build: astro output + esbuilt node entries -------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Astro → dist/ (dist/server/entry.mjs under Astro 5). No SITE_URL here:
# the public origin is runtime env now (issue #39).
RUN npm run build
# Server-only Node entries (no Astro/Vite): native node runs these with
# the runtime's node_modules — everything stays --packages=external.
RUN ./node_modules/.bin/esbuild src/jobs/boot.ts \
      --bundle --platform=node --format=esm --packages=external --sourcemap \
      --outfile=dist/jobs/boot.mjs && \
    ./node_modules/.bin/esbuild src/db/migrate.ts \
      --bundle --platform=node --format=esm --packages=external --sourcemap \
      --outfile=dist/jobs/migrate.mjs && \
    ./node_modules/.bin/esbuild src/jobs/run.ts \
      --bundle --platform=node --format=esm --packages=external --sourcemap \
      --outfile=dist/jobs/run.mjs && \
    ./node_modules/.bin/esbuild src/jobs/backfill-covers.ts \
      --bundle --platform=node --format=esm --packages=external --sourcemap \
      --outfile=dist/jobs/backfill-covers.mjs
# The runtime tree: prod-only (issue #48) — the runtime stage copies it
# and installs nothing itself.
RUN npm prune --omit=dev && \
    rm -f node_modules/better-sqlite3/prebuilds/darwin-*.node \
          node_modules/better-sqlite3/prebuilds/win32-*.node

# ---- runtime: prebuilt prod tree, no installer, no toolchain ------------
FROM base AS runtime
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
# Image defaults so a plain `docker run` needs only SITE_URL.
ENV DATABASE_URL=/data/bum.db
ENV HOST=0.0.0.0 PORT=4321
# boot.mjs DELIBERATELY starts as root: it validates env, chowns the
# bind-mounted data dir to `node`, drops to that user via setgid/setuid,
# migrates, then supervises web + the cron jobs as `node` (issue #39).
ENTRYPOINT ["node", "dist/jobs/boot.mjs"]
