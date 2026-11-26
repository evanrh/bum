import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { nextVersion } from '../../scripts/next-version.mjs';

const SCRIPT_PATH = path.resolve(import.meta.dirname, '../../scripts/next-version.mjs');

describe('nextVersion — the commit-scan rule (issue #59)', () => {
  it('a feat commit ⇒ minor, resetting the patch', () => {
    expect(nextVersion('v1.2.1', ['feat(#31): opengraph embeds'])).toBe('1.3.0');
    expect(nextVersion('v1.0.9', ['feat(#12): thing'])).toBe('1.1.0');
  });

  it('everything else ⇒ patch: fix, chore, docs, raw merges', () => {
    expect(nextVersion('v1.2.1', ['fix(#27): covers self-heal'])).toBe('1.2.2');
    expect(nextVersion('v1.2.1', ['chore: bump version to 1.2.1'])).toBe('1.2.2');
    expect(nextVersion('v1.2.1', ['docs: plan reorganization'])).toBe('1.2.2');
    expect(nextVersion('v2.0.0', ["Merge branch 'feat/1-thing'"])).toBe('2.0.1');
  });

  it('batch merges: one feat among fixes ⇒ minor once, not per commit', () => {
    expect(
      nextVersion('v1.2.1', [
        'feat(#52): mobile nav drawer',
        'feat(#53): admin icons',
        'fix(#54): sorts',
        "Merge branch 'feat/52-53-54-batch'",
      ]),
    ).toBe('1.3.0');
  });

  it('no v* tag yet → the 1.0.0 baseline decides', () => {
    expect(nextVersion(null, ['feat(#1): first feature'])).toBe('1.1.0');
    expect(nextVersion(null, ['feat', 'chore: setup'])).toBe('1.1.0');
    expect(nextVersion(null, ['chore: setup'])).toBe('1.0.1');
  });

  it('an invalid last tag (wrong shape) falls back to the 1.0.0 baseline too', () => {
    expect(nextVersion('main', ['feat(#1): thing'])).toBe('1.1.0');
    expect(nextVersion('v1.2', ['fix(#1): thing'])).toBe('1.0.1');
  });

  it('semver tolerance: prerelease tags parse, and inc releases them', () => {
    expect(nextVersion('v1.2.3-rc.1', ['feat(#7): thing'])).toBe('1.3.0');
    expect(nextVersion('v1.2.3-rc.1', ['fix(#8): thing'])).toBe('1.2.3'); // the rc ships
  });

  it('feat must stand alone: lookalike subjects stay a patch', () => {
    expect(nextVersion('v1.2.1', ['featured: not a feature commit'])).toBe('1.2.2');
    expect(nextVersion('v1.2.1', ['feature-flag cleanup'])).toBe('1.2.2');
  });
});

describe('next-version.mjs CLI against a real git repo', () => {
  let fixtureDir: string;

  const fixture = (): string => {
    fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'bum-next-version-'));
    git('init', '-b', 'main');
    git('config', 'user.name', 'bum test');
    git('config', 'user.email', 'test@bum.local');
    return fixtureDir;
  };

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: fixtureDir, encoding: 'utf8' });

  /** A commit (and optional v-tag) whose subject the scanner reads. */
  const commit = (message: string, tag?: string): void => {
    writeFileSync(path.join(fixtureDir, 'file.txt'), `${message}-${Date.now()}`);
    git('add', '-A');
    // -c overrides keep the runner's git config from leaking into the fixture
    git('-c', 'user.name=test', '-c', 'user.email=test@bum.local', 'commit', '-m', message);
    if (tag !== undefined) git('tag', tag);
  };

  const runScript = (): string =>
    execFileSync(process.execPath, [SCRIPT_PATH], {
      cwd: fixtureDir,
      encoding: 'utf8',
    }).trim();

  afterEach(() => {
    if (fixtureDir !== undefined) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('fix commits since the last tag → a patch bump', () => {
    fixture();
    commit('base', 'v1.2.1');
    commit('fix(#12): covers self-heal');
    expect(runScript()).toBe('1.2.2');
  });

  it('one feat among many subjects → minor (the batch-merge shape)', () => {
    fixture();
    commit('base', 'v1.2.1');
    commit('fix(#1): a');
    commit('feat(#52): mobile nav drawer');
    commit('fix(#2): b');
    expect(runScript()).toBe('1.3.0');
  });

  it('merges and chores alone → patch; featureless history still bumps', () => {
    fixture();
    commit('base', 'v2.0.0');
    commit("Merge branch 'feat/1-thing'");
    expect(runScript()).toBe('2.0.1');
  });

  it('picks the highest v-tag even across minor-magnitude jumps', () => {
    fixture();
    commit('base low', 'v1.9.0');
    commit('bigger release', 'v1.10.0');
    commit('fix(#3): after the big one');
    expect(runScript()).toBe('1.10.1');
  });

  it('a fresh repo with no v* tag falls back to the 1.0.0 baseline', () => {
    fixture();
    commit('chore: setup');
    commit('fix(#1): first fix');
    expect(runScript()).toBe('1.0.1');
  });
});
