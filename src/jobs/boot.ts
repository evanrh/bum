import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { chownSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { databasePath } from '../db/index.ts';
import { migrateDatabase } from '../db/migrations.ts';
import { parseSiteUrl } from '../lib/config.ts';

/**
 * Container boot entrypoint (issue #39): the image's single ENTRYPOINT
 * process. The order is load-bearing — required env first (nothing may run
 * before it validates), then the data dir is prepared and privileges drop
 * to `node` while still root (bind mounts arrive root-owned), then
 * migrations, then web + cron spawn (supervised: a child dying stops the
 * container so the restart policy recovers).
 */

export type NodeIdentity = { uid: number; gid: number };

/** The spawn contract boot needs — ChildProcess satisfies it structurally. */
export type SpawnedChild = {
  pid?: number;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
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
      if (Number.isFinite(uid) && Number.isFinite(gid)) return { uid, gid };
      break;
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
 * Validate env → prepare/privilege-drop → migrate → supervise web + jobs.
 * Resolves with the container exit code: 0 on a clean stop, 1 when a child
 * died un-asked. Throws before anything spawns when the env is unusable.
 */
export async function runBoot(deps: BootDeps = {}): Promise<number> {
  const log = (message: string): void => (deps.log ?? console.log)(`[bum] ${message}`);

  const site = parseSiteUrl(process.env.SITE_URL);
  log(`env ok — OG links use ${site.origin}`);

  if ((deps.isRoot ?? isRoot)()) {
    const identity = (deps.resolveIdentity ?? resolveNodeIdentity)();
    const dbDir = path.dirname(databasePath());
    (deps.prepareDataDir ?? prepareDataDir)(dbDir, identity);
    log(`data dir ${dbDir} prepared for uid ${identity.uid}/gid ${identity.gid}`);
    (deps.dropToNode ?? dropToNode)(identity);
    log('continuing as the `node` user');
  }

  const { count } = (deps.applyMigrations ?? defaultMigrations)();
  log(`migrations applied — journal entries: ${count}`);

  const spawnChild =
    deps.spawn ?? ((command: string, args: string[], options?: SpawnOptions): SpawnedChild =>
      spawn(command, args, { stdio: 'inherit', ...options }));
  const jobs = spawnChild('node', ['dist/jobs/run.mjs']);
  const web = spawnChild('node', ['dist/server/entry.mjs']);
  log(`supervising web (pid ${web.pid ?? 'n/a'}) and jobs (pid ${jobs.pid ?? 'n/a'})`);

  let shuttingDown = false;
  let alive = 2;
  const killAll = (signal: NodeJS.Signals): void => {
    shuttingDown = true;
    jobs.kill(signal);
    web.kill(signal);
  };
  const register = deps.registerSignal ?? registerSignal;
  register('SIGTERM', () => killAll('SIGTERM'));
  register('SIGINT', () => killAll('SIGINT'));

  return await new Promise<number>((resolve) => {
    const watch = (name: string, child: SpawnedChild): void => {
      child.on('exit', (code, signal) => {
        alive -= 1;
        if (shuttingDown) {
          if (alive === 0) resolve(0);
          return;
        }
        log(`${name} exited un-asked (code ${code}, signal ${signal}) — stopping the container`);
        resolve(1);
        killAll('SIGTERM');
      });
    };
    watch('jobs', jobs);
    watch('web', web);
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
