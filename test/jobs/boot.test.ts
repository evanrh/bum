import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  chownTree,
  prepareDataDir,
  resolveNodeIdentity,
  runBoot,
  type NodeIdentity,
  type SpawnedChild,
} from '../../src/jobs/boot.ts';

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

class FakeChild {
  pid = 4242;
  killedWith: string | null = null;
  exitHandlers: ExitListener[] = [];
  errorHandlers: Array<(error: Error) => void> = [];

  on(event: 'exit' | 'error', listener: ExitListener | ((error: Error) => void)): unknown {
    if (event === 'exit') this.exitHandlers.push(listener as ExitListener);
    else this.errorHandlers.push(listener as (error: Error) => void);
    return this;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal ?? 'SIGTERM';
    return true;
  }

  /** Simulate a child death (code or signal, mirroring the real event). */
  exit(code: number | null = null, signal: NodeJS.Signals | null = 'SIGTERM'): void {
    for (let handler of [...this.exitHandlers]) handler(code, signal);
  }

  /** Simulate a spawn failure: real children emit `error` with no `exit`. */
  fail(error: Error): void {
    for (let handler of [...this.errorHandlers]) handler(error);
  }
}

const asSpawned = (child: FakeChild): SpawnedChild => child as unknown as SpawnedChild;

/**
 * Yield one macrotask so runBoot's suspended body (awaited migrations)
 * resumes and finishes spawning before the test pokes children/signals.
 */
const yieldToBody = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('resolveNodeIdentity', () => {
  it('reads uid/gid for the `node` user', () => {
    const passwd = path.join(mkdtempSync(path.join(tmpdir(), 'bum-boot-')), 'passwd');
    writeFileSync(
      passwd,
      'root:x:0:0:root:/root:/bin/sh\ndaemon:x:1:1:daemon:/usr/sbin:/bin/sh\nnode:x:1000:1000:node:/home/node:/bin/sh\n',
    );
    expect(resolveNodeIdentity(passwd)).toEqual({ uid: 1000, gid: 1000 });
  });

  it('a malformed `node` line falls through to a later valid one', () => {
    const passwd = path.join(mkdtempSync(path.join(tmpdir(), 'bum-boot-')), 'passwd');
    writeFileSync(passwd, 'node:x:not-a-number:oops\nnode:x:1001:1001:node:/home/node:/bin/sh\n');
    expect(resolveNodeIdentity(passwd)).toEqual({ uid: 1001, gid: 1001 });
  });

  it('fails loudly when the user is missing or the file absent', () => {
    const passwd = path.join(mkdtempSync(path.join(tmpdir(), 'bum-boot-')), 'passwd');
    writeFileSync(passwd, 'root:x:0:0:root:/root:/bin/sh\n');
    expect(() => resolveNodeIdentity(passwd)).toThrow(/no usable `node` entry/);
    expect(() => resolveNodeIdentity(path.join(passwd, 'missing'))).toThrow(/not found/);
  });
});

describe('prepareDataDir / chownTree', () => {
  // Types flag the POSIX-only getters as optional; the values exist on macOS
  // and Linux alike.
  const identity = (): NodeIdentity => ({
    uid: typeof process.getuid === 'function' ? process.getuid() : 501,
    gid: typeof process.getgid === 'function' ? process.getgid() : 20,
  });

  it('creates the dir tree and chowns contents without following symlinks', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'bum-data-'));
    const nested = path.join(base, 'sub');
    mkdirSync(nested);
    writeFileSync(path.join(nested, 'bum.db'), 'x');
    symlinkSync(path.join(nested, 'bum.db'), path.join(base, 'link-to-file'));

    expect(() => chownTree(base, identity())).not.toThrow();
    expect(() => prepareDataDir(path.join(base, 'new', 'tree'), identity())).not.toThrow();
  });
});

describe('runBoot', () => {
  const savedSiteUrl = process.env.SITE_URL;
  const savedDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    // Every boot path except the preflight test needs a valid origin.
    process.env.SITE_URL = 'https://bum.example.com';
  });

  afterEach(() => {
    if (savedSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = savedSiteUrl;
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  });

  const childPair = (): { jobs: FakeChild; web: FakeChild } => ({
    jobs: new FakeChild(),
    web: new FakeChild(),
  });

  const fakeSpawn =
    (pair: { jobs: FakeChild; web: FakeChild }) =>
    (command: string, args: string[]): SpawnedChild =>
      asSpawned(args[0].includes('run.mjs') ? pair.jobs : pair.web);

  it('preflights env first: missing SITE_URL throws before migrating or spawning', async () => {
    delete process.env.SITE_URL;
    const effects: string[] = [];
    await expect(
      runBoot({
        applyMigrations: () => {
          effects.push('migrations');
          return { count: 0 };
        },
        spawn: () => {
          effects.push('spawn');
          throw new Error('must not spawn');
        },
      }),
    ).rejects.toThrow(/SITE_URL is required at runtime/);
    expect(effects).toEqual([]);
  });

  it('as root: prepares the db dir for `node`, drops privileges, then migrates', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'bum-root-'));
    process.env.DATABASE_URL = path.join(dataDir, 'bum.db');
    const effects: string[] = [];
    const identity = { uid: 1000, gid: 1000 };
    const pair = childPair();
    const handlers = new Map<NodeJS.Signals, () => void>();
    const pending = runBoot({
      isRoot: () => true,
      resolveIdentity: () => identity,
      prepareDataDir: (dir) => {
        effects.push(`prepare:${dir}`);
      },
      dropToNode: () => {
        effects.push('drop');
      },
      applyMigrations: () => {
        effects.push('migrations');
        return { count: 3 };
      },
      registerSignal: (signal, handler) => {
        handlers.set(signal, handler);
      },
      spawn: (command, args) => {
        effects.push(`spawn:${path.basename(args[0])}`);
        return fakeSpawn(pair)(command, args);
      },
      log: () => {},
    });
    await yieldToBody();
    expect(effects).toEqual([
      `prepare:${dataDir}`,
      'drop',
      'migrations',
      'spawn:run.mjs',
      'spawn:entry.mjs',
    ]);
    handlers.get('SIGTERM')?.();
    expect(pair.jobs.killedWith).toBe('SIGTERM');
    pair.web.exit(null);
    pair.jobs.exit(null);
    expect(await pending).toBe(0);
  });

  it('non-root (local dev): migrates and supervises without privilege work', async () => {
    process.env.DATABASE_URL = path.join(mkdtempSync(path.join(tmpdir(), 'bum-local-')), 'bum.db');
    const effects: string[] = [];
    const pair = childPair();
    const handlers = new Map<NodeJS.Signals, () => void>();
    const pending = runBoot({
      isRoot: () => false,
      applyMigrations: () => {
        effects.push('migrations');
        return { count: 2 };
      },
      registerSignal: (signal, handler) => {
        handlers.set(signal, handler);
      },
      spawn: (command, args) => {
        effects.push(`spawn:${path.basename(args[0])}`);
        return fakeSpawn(pair)(command, args);
      },
      log: () => {},
    });
    await yieldToBody();
    expect(effects).toEqual(['migrations', 'spawn:run.mjs', 'spawn:entry.mjs']);
    handlers.get('SIGTERM')?.(); // container stop
    expect(pair.jobs.killedWith).toBe('SIGTERM');
    expect(pair.web.killedWith).toBe('SIGTERM');
    pair.web.exit(null);
    pair.jobs.exit(null);
    expect(await pending).toBe(0);
  });

  it('a stop arriving during startup exits cleanly before spawning', async () => {
    const effects: string[] = [];
    const handlers = new Map<NodeJS.Signals, () => void>();
    const pending = runBoot({
      isRoot: () => false,
      applyMigrations: () => {
        effects.push('migrations');
        return { count: 2 };
      },
      registerSignal: (signal, handler) => {
        handlers.set(signal, handler);
      },
      spawn: () => {
        throw new Error('must not spawn after a stop was requested');
      },
      log: () => {},
    });
    handlers.get('SIGINT')?.(); // docker stop while migrations run
    expect(await pending).toBe(0);
    expect(effects).toEqual(['migrations']);
  });

  it('a child failing to START (error, no exit) stops the container with exit 1', async () => {
    const pair = childPair();
    const pending = runBoot({
      isRoot: () => false,
      applyMigrations: () => ({ count: 1 }),
      registerSignal: () => {},
      spawn: (command, args) => fakeSpawn(pair)(command, args),
      log: () => {},
    });
    await yieldToBody();
    pair.web.fail(new Error('EACCES spawning'));
    expect(await pending).toBe(1);
    expect(pair.jobs.killedWith).toBe('SIGTERM');
  });

  it('both children dying un-asked resolves 1 without a second finish', async () => {
    const pair = childPair();
    const pending = runBoot({
      isRoot: () => false,
      applyMigrations: () => ({ count: 1 }),
      registerSignal: () => {},
      spawn: (command, args) => fakeSpawn(pair)(command, args),
      log: () => {},
    });
    await yieldToBody();
    pair.web.exit(1, null);
    pair.jobs.exit(1, null);
    expect(await pending).toBe(1);
  });

  it('runs the REAL spawn/signal path (no injected dependencies)', async () => {
    // Real child_process with real exit events; only signal capture is
    // swappable so the test can drive shutdown deterministically without
    // sending OS signals to the vitest worker itself. The spawned run.mjs
    // inherits this worker's env — always pin DATABASE_URL or it opens the
    // developer's real ./data/dev.db (repo cwd).
    process.env.DATABASE_URL = path.join(mkdtempSync(path.join(tmpdir(), 'bum-real-')), 'bum.db');
    const handlers = new Map<NodeJS.Signals, () => void>();
    const pending = runBoot({
      isRoot: () => false,
      applyMigrations: () => ({ count: 2 }),
      registerSignal: (signal, handler) => {
        handlers.set(signal, handler);
      },
      spawn: (command, args, options) => spawn(command, args, { stdio: 'ignore', ...options }),
      log: () => {},
    });
    await yieldToBody();
    handlers.get('SIGTERM')?.(); // real children get killed → exit events fire
    expect(await pending).toBe(0);
  });

  it('root + :memory: skips data-dir preparation entirely', async () => {
    process.env.DATABASE_URL = ':memory:';
    const effects: string[] = [];
    const pair = childPair();
    const handlers = new Map<NodeJS.Signals, () => void>();
    const pending = runBoot({
      isRoot: () => true,
      resolveIdentity: () => {
        throw new Error('identity must not be needed for :memory:');
      },
      prepareDataDir: () => {
        effects.push('prepare');
      },
      dropToNode: () => {
        effects.push('drop');
      },
      applyMigrations: () => ({ count: 0 }),
      registerSignal: (signal, handler) => {
        handlers.set(signal, handler);
      },
      spawn: (command, args) => {
        effects.push(`spawn:${path.basename(args[0])}`);
        return fakeSpawn(pair)(command, args);
      },
      log: () => {},
    });
    await yieldToBody();
    expect(effects).toEqual(['spawn:run.mjs', 'spawn:entry.mjs']);
    handlers.get('SIGTERM')?.();
    pair.web.exit(null);
    pair.jobs.exit(null);
    expect(await pending).toBe(0);
  });
});
