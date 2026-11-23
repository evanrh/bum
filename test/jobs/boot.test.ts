import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  chownTree,
  prepareDataDir,
  resolveNodeIdentity,
  runBoot,
  type BootDeps,
  type NodeIdentity,
  type SpawnedChild,
} from '../../src/jobs/boot.ts';

class FakeChild {
  pid = 4242;
  killedWith: string | null = null;
  exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];

  on(_event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown {
    this.exitHandlers.push(listener);
    return this;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal ?? 'SIGTERM';
    return true;
  }

  exit(code: number | null = null, signal: NodeJS.Signals | null = 'SIGTERM'): void {
    for (const handler of [...this.exitHandlers]) handler(code, signal);
  }
}

const asSpawned = (child: FakeChild): SpawnedChild => child as unknown as SpawnedChild;

describe('resolveNodeIdentity', () => {
  it('reads uid/gid for the `node` user', () => {
    const passwd = path.join(mkdtempSync(path.join(tmpdir(), 'bum-boot-')), 'passwd');
    writeFileSync(
      passwd,
      'root:x:0:0:root:/root:/bin/sh\ndaemon:x:1:1:daemon:/usr/sbin:/bin/sh\nnode:x:1000:1000:node:/home/node:/bin/sh\n',
    );
    expect(resolveNodeIdentity(passwd)).toEqual({ uid: 1000, gid: 1000 });
  });

  it('fails loudly when the user is missing or the file absent', () => {
    const passwd = path.join(mkdtempSync(path.join(tmpdir(), 'bum-boot-')), 'passwd');
    writeFileSync(passwd, 'root:x:0:0:root:/root:/bin/sh\n');
    expect(() => resolveNodeIdentity(passwd)).toThrow(/no usable `node` entry/);
    expect(() => resolveNodeIdentity(path.join(passwd, 'missing'))).toThrow(/not found/);
  });
});

describe('prepareDataDir / chownTree', () => {
  // Types flag the POSIX-only setters/getters as optional; the values exist
  // on macOS and Linux alike.
  const identity = (): NodeIdentity => ({
    uid: typeof process.getuid === 'function' ? process.getuid() : 501,
    gid: typeof process.getgid === 'function' ? process.getgid() : 20,
  });

  it('creates the dir tree and chowns contents without following symlinks', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'bum-data-'));
    const nested = path.join(base, 'sub');
    mkdirSync(nested);
    const file = path.join(nested, 'bum.db');
    writeFileSync(file, 'x');
    const link = path.join(base, 'link-to-file');
    symlinkSync(file, link);

    const target = path.join(base, 'new', 'tree');
    expect(() => prepareDataDir(target, identity())).not.toThrow();
    expect(chownTree(base, identity())).toBeUndefined();
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
    const jobsChild = new FakeChild();
    const webChild = new FakeChild();
    const exitHandlers: Array<() => void> = [];
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
      registerSignal: (_signal, handler) => {
        exitHandlers.push(handler);
      },
      spawn: (_command, args) => {
        effects.push(`spawn:${args[0]}`);
        return asSpawned(args[0].includes('run.mjs') ? jobsChild : webChild);
      },
      log: () => {},
    });
    expect(effects).toEqual([`prepare:${dataDir}`, 'drop', 'migrations', 'spawn:dist/jobs/run.mjs', 'spawn:dist/server/entry.mjs']);
    exitHandlers[0]?.(); // SIGTERM → container stop
    expect(jobsChild.killedWith).toBe('SIGTERM');
    webChild.exit(null);
    jobsChild.exit(null);
    expect(await pending).toBe(0);
  });

  it('non-root (local dev): migrates and supervises without privilege work', async () => {
    process.env.DATABASE_URL = path.join(mkdtempSync(path.join(tmpdir(), 'bum-local-')), 'bum.db');
    const effects: string[] = [];
    const jobsChild = new FakeChild();
    const webChild = new FakeChild();
    const signalHandlers: Array<() => void> = [];
    const pending = runBoot({
      isRoot: () => false,
      applyMigrations: () => {
        effects.push('migrations');
        return { count: 2 };
      },
      registerSignal: (_signal, handler) => {
        signalHandlers.push(handler);
      },
      spawn: (_command, args) => {
        effects.push(`spawn:${args[0]}`);
        return asSpawned(args[0].includes('run.mjs') ? jobsChild : webChild);
      },
      log: () => {},
    });
    expect(effects).toEqual(['migrations', 'spawn:dist/jobs/run.mjs', 'spawn:dist/server/entry.mjs']);
    signalHandlers[0]?.(); // SIGTERM → clean shutdown request
    expect(jobsChild.killedWith).toBe('SIGTERM');
    expect(webChild.killedWith).toBe('SIGTERM');
    webChild.exit(null);
    jobsChild.exit(null);
    expect(await pending).toBe(0);
  });

  it('a child dying un-asked stops the container with exit code 1', async () => {
    const jobsChild = new FakeChild();
    const webChild = new FakeChild();
    const pending = runBoot({
      isRoot: () => false,
      applyMigrations: () => ({ count: 1 }),
      registerSignal: () => {},
      spawn: (_command, args) => asSpawned(args[0].includes('run.mjs') ? jobsChild : webChild),
      log: () => {},
    });
    webChild.exit(1, null);
    expect(await pending).toBe(1);
    expect(jobsChild.killedWith).toBe('SIGTERM');
  });
});
