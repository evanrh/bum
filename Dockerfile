# syntax=docker/dockerfile:1

# ---- base ---------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- deps: full dependency tree (incl. dev) for the build stages --------
FROM base AS deps
COPY package.json package-lock.json ./
RUN apk add --no-cache python3 make g++ && npm ci --include=dev

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

# ---- runtime: production deps only --------------------------------------
FROM base AS runtime
# Build tools for better-sqlite3's native binding if no musl prebuild hits.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
RUN mkdir -p /data && chown node:node /data
USER node
# Image defaults so a plain `docker run` needs only SITE_URL.
ENV DATABASE_URL=/data/bum.db
ENV HOST=0.0.0.0 PORT=4321
# boot.mjs validates env, prepares /data + drops privileges, migrates, then
# supervises web + the cron jobs (issue #39).
ENTRYPOINT ["node", "dist/jobs/boot.mjs"]
