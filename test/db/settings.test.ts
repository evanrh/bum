import { beforeEach, describe, expect, it, afterEach } from 'vitest';

import * as settingsRepo from '../../src/db/repos/settings.ts';
import { makeDb } from './helpers.ts';

let db: ReturnType<typeof makeDb>;
let envBackup: string | undefined;

beforeEach(() => {
  db = makeDb();
  envBackup = process.env.BOOTSTRAP_JOIN_CODE;
});

afterEach(() => {
  if (envBackup === undefined) delete process.env.BOOTSTRAP_JOIN_CODE;
  else process.env.BOOTSTRAP_JOIN_CODE = envBackup;
});

describe('settings repo', () => {
  it('getSettings bootstraps once and returns the same row on repeat calls', async () => {
    const first = await settingsRepo.getSettings(db, 1000);
    const second = await settingsRepo.getSettings(db, 2000);
    expect(second).toEqual(first);
    expect(second.id).toBe(1);
    expect(second.rotation).toBe('[]');
    expect(second.lastRotatedWeek).toBeNull();
  });

  it('the rotation queue defaults to empty on a fresh database', async () => {
    expect(await settingsRepo.getRotation(db)).toEqual([]);
  });

  it('setRotation round-trips the queue and bumps updated_at', async () => {
    await settingsRepo.getSettings(db, 1000);
    await settingsRepo.setRotation(db, [7, 3, 11], 2000);
    expect(await settingsRepo.getRotation(db)).toEqual([7, 3, 11]);
    const row = await settingsRepo.getSettings(db);
    expect(row.updatedAt).toBe(2000);
    await settingsRepo.setRotation(db, [], 3000);
    expect(await settingsRepo.getRotation(db)).toEqual([]);
    expect((await settingsRepo.getSettings(db)).updatedAt).toBe(3000);
  });

  it('setLastRotatedWeek stores the checkpoint and clears it back to null', async () => {
    await settingsRepo.getSettings(db, 1000);
    await settingsRepo.setLastRotatedWeek(db, '2026-01-05', 2000);
    expect((await settingsRepo.getSettings(db)).lastRotatedWeek).toBe('2026-01-05');
    expect((await settingsRepo.getSettings(db)).updatedAt).toBe(2000);
    await settingsRepo.setLastRotatedWeek(db, null, 3000);
    expect((await settingsRepo.getSettings(db)).lastRotatedWeek).toBeNull();
    expect((await settingsRepo.getSettings(db)).updatedAt).toBe(3000);
  });

  it('respects BOOTSTRAP_JOIN_CODE when set (no plaintext logged)', async () => {
    const logged: string[] = [];
    const spy = console.log;
    console.log = (...args: unknown[]) => logged.push(args.join(' '));
    process.env.BOOTSTRAP_JOIN_CODE = 'TESTCODE123';
    try {
      const settings = await settingsRepo.getSettings(db, 1000);
      expect(await settingsRepo.verifyJoinCode(db, 'TESTCODE123')).toBe(true);
      expect(await settingsRepo.verifyJoinCode(db, 'WRONGWRONG')).toBe(false);
      expect(settings.joinCodeHash.startsWith('$')).toBe(true);
      expect(logged.some((l) => l.includes('bootstrap join code'))).toBe(false);
    } finally {
      console.log = spy;
    }
  });

  it('generates a crockford-base32 code and logs the plaintext exactly once', async () => {
    const logged: string[] = [];
    const spy = console.log;
    console.log = (...args: unknown[]) => logged.push(args.join(' '));
    try {
      await settingsRepo.getSettings(db, 1000);
      expect(logged.filter((l) => l.includes('bootstrap join code'))).toHaveLength(1);
      expect(logged.find((l) => l.includes('bootstrap join code'))).toMatch(/bootstrap join code: ([0-9A-HJ-NP-TV-Z]{8}) /);
    } finally {
      console.log = spy;
    }
  });

  it('verifyJoinCode accepts the real code and rejects wrong ones', async () => {
    process.env.BOOTSTRAP_JOIN_CODE = 'GOODCODE1';
    await settingsRepo.getSettings(db, 1000);
    expect(await settingsRepo.verifyJoinCode(db, 'GOODCODE1')).toBe(true);
    expect(await settingsRepo.verifyJoinCode(db, 'GOODCODE2')).toBe(false);
    expect(await settingsRepo.verifyJoinCode(db, '')).toBe(false);
  });

  it('rotateJoinCode invalidates the old code and returns the new plaintext', async () => {
    process.env.BOOTSTRAP_JOIN_CODE = 'OLDOLDOLD';
    await settingsRepo.getSettings(db, 1000);
    const newCode = await settingsRepo.rotateJoinCode(db, 2000);
    expect(newCode).toHaveLength(8);
    expect(await settingsRepo.verifyJoinCode(db, 'OLDOLDOLD')).toBe(false);
    expect(await settingsRepo.verifyJoinCode(db, newCode)).toBe(true);
  });

  it('updateSettings whitelists fields and bumps updated_at', async () => {
    const created = await settingsRepo.getSettings(db, 1000);
    const updated = await settingsRepo.updateSettings(
      db,
      {
        groupName: 'Loud Basement Club',
        joiningEnabled: false,
        // smuggled fields are dropped by the whitelist — typed as never here
        ...( { passwordHash: 'sneaky' } as object as settingsRepo.UpdatedSettingsFields),
      },
      3000,
    );
    expect(updated.groupName).toBe('Loud Basement Club');
    expect(updated.joiningEnabled).toBe(false);
    expect(updated.updatedAt).toBe(3000);
    expect(updated.createdAt).toBe(1000);
    expect(updated.joinCodeHash).toBe(created.joinCodeHash);
  });
});
