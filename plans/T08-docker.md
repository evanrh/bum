# T08 — Docker

Status: ⬜
Depends on: T01–T05 (T06/T07 recommended — the image should ship the full app)

## Goal

Package the app as a single production image and run it as three compose
services (`migrate`, `web`, `jobs`) over one SQLite volume. Node 24
(`node:24-alpine`), matching the local dev engines field.

## Deliverables

### 1. `Dockerfile` (multi-stage)

- **base**: `FROM node:24-alpine`; `WORKDIR /app`; `ENV NODE_ENV=production`.
- **deps**: copy `package.json` + `package-lock.json` → `npm ci`.
- **build**: copy source → `npm run build` (Astro → `dist/`).
  Then bundle the non-Astro entries with esbuild (add `esbuild` as a dev
  dependency in this ticket):
  - `src/db/migrate.ts` → `dist/jobs/migrate.mjs`
  - `src/jobs/run.ts` → `dist/jobs/run.mjs`
  Use `--platform=node --format=esm --packages=external --sourcemap`
  (keep `better-sqlite3`, `drizzle-orm`, `bcryptjs`, `node-cron` external;
  explicit `.ts` imports resolve fine under esbuild). These are
  server-only files compiled for native Node — no Astro/Vite involved.
- **runtime**: `FROM node:24-alpine`; `npm ci --omit=dev`; copy
  `dist/`, `drizzle/` (SQL migrations), `package.json`. `USER node`.
  `ENV HOST=0.0.0.0 PORT=4321`.
  - `ENTRYPOINT ["node", "dist/server/entry.mjs"]` is the default (web);
    compose overrides per service. (Astro's standalone output path: under
    Astro 5 the built entry is `dist/server/entry.mjs` — verify against
    the built tree and note any difference.)

### 2. `.dockerignore`

`node_modules`, `dist`, `.astro`, `data`, `.git`, `coverage`,
`.env*` (but allow later if useful), `*.log`. Small context, no local
state leaks into images.

### 3. `docker-compose.yml`

```yaml
services:
  migrate:
    build: .
    command: ["node", "dist/jobs/migrate.mjs"]
    environment: { DATABASE_URL: /data/bum.db }
    volumes: ["./data:/data"]
    restart: "no"
  web:
    build: .
    environment: { DATABASE_URL: /data/bum.db, HOST: 0.0.0.0, PORT: "4321" }
    ports: ["4321:4321"]
    volumes: ["./data:/data"]
    depends_on:
      migrate:
        condition: service_completed_successfully
    init: true
  jobs:
    build: .
    command: ["node", "dist/jobs/run.mjs"]
    environment: { DATABASE_URL: /data/bum.db, JOBS_CRON: "on" }
    volumes: ["./data:/data"]
    depends_on:
      migrate:
        condition: service_completed_successfully
    init: true
```

Notes:

- All three services share the volume; SQLite WAL handles the
  concurrency (web writes + jobs reads/writes at 00:10).
- `JOBS_CRON=on` keeps the long-lived cron mode; without it the runner
  exits after one pass (T05 behavior).
- Add a `.env.example`: `DATABASE_PATH=/data/bum.db`, `PORT=4321`,
  `BOOTSTRAP_JOIN_CODE=` (optional, first-run pin).
- Image builds once (compose `build: .` dedupes).

### 4. `.env.example` + README ops paragraph

Short section in `README.md`: `docker compose build`, `docker compose up
-d`, where data lives, how to rotate the join code, backup hint
(`sqlite3 data/bum.db ".backup data/backup.db"` or just stop+jail-cop the
file), and the one-container alternative
(`docker run --init -v $PWD/data:/data` running web only for the
single-process case).

## Tests / verification

No unit tests (infrastructure); acceptance is doing it:

- [ ] `docker compose build` succeeds (also run
      `docker compose run --rm migrate` standalone)
- [ ] `docker compose up`: `migrate` exits 0; `web` serves the app on
      `http://localhost:4321` (200 on `/`); `jobs` logs "jobs runner
      ready" and stays alive
- [ ] End-to-end through containers: signup via the env bootstrap/seeded
      join code works; an album submitted via `curl` persists after
      `docker compose down && docker compose up` (volume proof)
- [ ] `docker compose ps` shows `migrate` exited(0), `web`/`jobs` running;
      Ctrl-C on `docker compose up` (foreground) stops cleanly within a
      few seconds (init/signal handling)
- [ ] Image size sanity: no dev dependencies in the runtime layer
      (`npm ls --omit=dev` in the image or `docker history` check)

## Out of scope

CI/CD (no pipelines requested), TLS (terminate elsewhere), orchestrating
beyond compose, healthcheck endpoints (optional — if quick, expose
`GET /api/health` returning `{ok: true}` in web and use it as a
compose healthcheck; note it in deviations if added).
