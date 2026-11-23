import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { chownSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { databasePath } from '../db/index.ts';
import { migrateDatabase } from '../db/migrations.ts';
import { parseSiteUrl } from '../lib/config.ts';

/**
 * Container boot entrypoint (issue #39): the image's single ENTRYPOINT
 * process. The order is load-bearing — signals attach first (pid 1 ignores
 * them by default, so a stop during startup is seen), then required env
 * (nothing may run before it validates), then the data dir is prepared and
 * privileges drop to `node` while still root (bind mounts arrive
 * root-owned), then migrations, then web + cron spawn (supervised: a child
 * failing or dying stops the container so the restart policy recovers).
 */

export type NodeIdentity = { uid: number; gid: number };

/** The spawn contract boot needs — ChildProcess satisfies it structurally. */
export type SpawnedChild = {
  pid?: number;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
};

export type BootDeps = {
  log?: (message: string) => void;
  spawn?: (command: string, args: string[], options?: SpawnOptions) => SpawnedChild;
  isRoot?: () => boolean;
  resolveIdentity?: (passwdPath?: string) => NodeIdentity;
  prepareDataDir?: (dir: string, identity: NodeIdentity) => void;
  dropToNode?: (identity: NodeIdentity) => void;
  applyMigrations?: () => { count: number };
  registerSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
};

// Node images ship an unprivileged `node` user; it is the container's
// target identity, so anything root-owned in the data dir gets handed to it.
export function resolveNodeIdentity(passwdPath: string = '/etc/passwd'): NodeIdentity {
  if (!existsSync(passwdPath)) {
    throw new Error('[bum] /etc/passwd not found — cannot resolve the `node` user to drop privileges');
  }
  for (const line of readFileSync(passwdPath, 'utf8').split('\n')) {
    const fields = line.split(':');
    if (fields[0] === 'node') {
      const uid = Number(fields[2]);
      const gid = Number(fields[3]);
      // A malformed `node` line must not shadow a later valid one.
      if (Number.isFinite(uid) && Number.isFinite(gid)) return { uid, gid };
    }
  }
  throw new Error('[bum] no usable `node` entry in /etc/passwd — cannot drop privileges');
}

/** Recursive owner fix for the data dir; symlinks are skipped, not followed. */
export function chownTree(root: string, identity: NodeIdentity): void {
  chownSync(root, identity.uid, identity.gid);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) chownTree(child, identity);
    else chownSync(child, identity.uid, identity.gid);
  }
}

export function prepareDataDir(dir: string, identity: NodeIdentity): void {
  mkdirSync(dir, { recursive: true });
  chownTree(dir, identity);
}

/**
 * Group drop first, uid last — reversing the order loses the capability.
 * The setters are typed optional (POSIX-only) but this image is musl Linux;
 * a missing setter is a hard, loud failure rather than a silent root run.
 */
export function dropToNode(identity: NodeIdentity): void {
  if (typeof process.setgid !== 'function' || typeof process.setuid !== 'function') {
    throw new Error('[bum] setgid/setuid unavailable in this runtime — cannot drop privileges');
  }
  process.setgid(identity.gid);
  process.setuid(identity.uid);
}

function defaultMigrations(): { count: number } {
  const { db, count } = migrateDatabase();
  db.$client.close();
  return { count };
}

function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function registerSignal(signal: NodeJS.Signals, handler: () => void): void {
  process.on(signal, handler);
}

/**
 * Repo/image root — two levels up from this file in BOTH layouts: from
 * `src/jobs/boot.ts` (dev) and from the bundled `dist/jobs/boot.mjs`
 * (image), `../../` lands on /app. Child paths are absolute so `docker
 * exec -w /some/dir` still finds the entries.
 */
export function appRoot(): string {
  return fileURLToPath(new URL('../..', import.meta.url));
}

/**
 * Validate env → prepare/privilege-drop → migrate → supervise web + jobs.
 * Resolves with the container exit code: 0 on a clean stop (including a
 * stop that arrived during startup), 1 when a child failed or died
 * un-asked. Throws before anything spawns when the env is unusable.
 */
export async function runBoot(deps: BootDeps = {}): Promise<number> {
  const log = (message: string): void => (deps.log ?? console.log)(`[bum] ${message}`);

  // Signals first: pid 1 ignores SIGTERM/SIGINT by default, so anything
  // arriving during env validation / migrations must be flagged now. Before
  // children exist the handlers only record the stop; afterwards they stop
  // the children too.
  let stopRequested = false;
  let children: { jobs: SpawnedChild; web: SpawnedChild } | undefined;
  const register = deps.registerSignal ?? registerSignal;
  const onSignal = (signal: NodeJS.Signals): void => {
    stopRequested = true;
    if (children) {
      children.jobs.kill(signal);
      children.web.kill(signal);
    }
  };
  register('SIGTERM', () => onSignal('SIGTERM'));
  register('SIGINT', () => onSignal('SIGINT'));

  // 1. Required env — before any filesystem or network action (issue #39).
  const site = parseSiteUrl(process.env.SITE_URL);
  log(`env ok — OG links use ${site.origin}`);

  // 2. Root preflight (containers): make the bind-mounted data dir writable
  //    by the unprivileged user, then continue as that user. Skipped for
  //    non-root runs (dev) and in-memory databases.
  const dbPath = databasePath();
  if ((deps.isRoot ?? isRoot)() && dbPath !== ':memory:') {
    const identity = (deps.resolveIdentity ?? resolveNodeIdentity)();
    const dbDir = path.dirname(dbPath);
    (deps.prepareDataDir ?? prepareDataDir)(dbDir, identity);
    log(`data dir ${dbDir} prepared for uid ${identity.uid}/gid ${identity.gid}`);
    (deps.dropToNode ?? dropToNode)(identity);
    log('continuing as the `node` user');
  }

  // 3. Migrations before web or jobs can touch the database.
  const { count } = await (deps.applyMigrations ?? defaultMigrations)();
  log(`migrations applied — journal entries: ${count}`);

  // 4. Supervise web + cron: inherit stdio (container logs), forward
  //    signals, and let a crashing child stop the container so the restart
  //    policy recovers.
  if (stopRequested) {
    log('stop requested during startup — exiting before spawning');
    return 0;
  }
  const spawnChild =
    deps.spawn ?? ((command: string, args: string[], options?: SpawnOptions): SpawnedChild =>
      spawn(command, args, { stdio: 'inherit', ...options }));
  const root = appRoot();
  const spawned: { jobs: SpawnedChild; web: SpawnedChild } = {
    jobs: spawnChild('node', [path.join(root, 'dist/jobs/run.mjs')]),
    web: spawnChild('node', [path.join(root, 'dist/server/entry.mjs')]),
  };
  children = spawned;
  log(`supervising web (pid ${spawned.web.pid ?? 'n/a'}) and jobs (pid ${spawned.jobs.pid ?? 'n/a'})`);

  return await new Promise<number>((resolve) => {
    let alive = 2;
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    const onEnded = (
      name: string,
      code: number | null,
      signal: NodeJS.Signals | null,
      failure?: Error,
    ): void => {
      if (stopRequested) {
        alive -= 1;
        if (alive === 0) finish(0);
        return;
      }
      const why = failure
        ? `failed to start (${failure.message})`
        : `exited un-asked (code ${code}, signal ${signal})`;
      log(`${name} ${why} — stopping the container`);
      finish(1);
      stopRequested = true;
      if (children) {
        children.jobs.kill('SIGTERM');
        children.web.kill('SIGTERM');
      }
    };
    const watch = (name: string, child: SpawnedChild): void => {
      // Spawn failure emits `error` with NO `exit` — both count as a death.
      child.on('error', (error: Error) => onEnded(name, null, null, error));
      child.on('exit', (code: number | null, signal: NodeJS.Signals | null) =>
        onEnded(name, code, signal),
      );
    };
    watch('jobs', spawned.jobs);
    watch('web', spawned.web);
  });
}

const isMainModule = (): boolean => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
};

// CLI entry: `node dist/jobs/boot.mjs` (image ENTRYPOINT).
if (isMainModule()) {
  try {
    process.exitCode = await runBoot();
  } catch (error) {
    console.error(`[bum] boot failed: ${(error as Error).message}`);
    process.exit(1);
  }
}
