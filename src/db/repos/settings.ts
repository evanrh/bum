import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

import { settings, type Settings, type SettingsInsert } from '../schema.ts';
import { parseQueue } from '../../lib/rotation.ts';
import type { Db } from '../index.ts';

const BCRYPT_COST = 12;
/** Crockford base32 (skips I, L, O, U) for human-transcribable codes. */
const JOIN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomJoinCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join('');
}

export type UpdatedSettingsFields = Partial<Pick<Settings, 'groupName' | 'joiningEnabled'>>;

/**
 * Read the singleton settings row, bootstrapping it on first use. The join
 * code comes from BOOTSTRAP_JOIN_CODE (env pin, e.g. in Docker) or is
 * generated; the plaintext is logged exactly once when generated (first-run
 * bootstrap UX).
 */
export async function getSettings(db: Db, now: number = Date.now()): Promise<Settings> {
  let [row] = await db.select().from(settings).limit(1);
  if (row) return row;

  const joinCode = (process.env.BOOTSTRAP_JOIN_CODE ?? '').trim() || randomJoinCode();
  const joinCodeHash = bcrypt.hashSync(joinCode, BCRYPT_COST);
  try {
    await db.insert(settings).values({
      id: 1,
      joinCodeHash,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    // Losing a UNIQUE(id=1) race is fine — someone else bootstrapped.
  }
  [row] = await db.select().from(settings).limit(1);
  if (!row) throw new Error('settings bootstrap failed');
  if (!(process.env.BOOTSTRAP_JOIN_CODE ?? '').trim()) {
    console.log(`[bum] bootstrap join code: ${joinCode} (shown once — rotate it from the admin panel)`);
  }
  return row;
}

export async function verifyJoinCode(db: Db, code: string): Promise<boolean> {
  const current = await getSettings(db);
  return bcrypt.compareSync(code, current.joinCodeHash);
}

/** Rotate the join code; the new plaintext is shown/returned exactly once. */
export async function rotateJoinCode(db: Db, now: number): Promise<string> {
  const joinCode = randomJoinCode();
  await db
    .update(settings)
    .set({ joinCodeHash: bcrypt.hashSync(joinCode, BCRYPT_COST), updatedAt: now })
    .where(eq(settings.id, 1));
  console.log(`[bum] join code rotated: ${joinCode} (shown once)`);
  return joinCode;
}

/** Whitelisted partial update of the singleton row. */
export async function updateSettings(
  db: Db,
  patch: UpdatedSettingsFields | SettingsInsert | (UpdatedSettingsFields & SettingsInsert),
  now: number,
): Promise<Settings> {
  // Explicit whitelist — unknown fields are dropped, not smuggled through.
  const allowed: Array<keyof Settings> = ['groupName', 'joiningEnabled'];
  const set: Record<string, unknown> = { updatedAt: now };
  for (const key of allowed) {
    if (patch[key as keyof typeof patch] !== undefined) {
      set[key] = patch[key as keyof typeof patch];
    }
  }
  const [row] = await db.update(settings).set(set).where(eq(settings.id, 1)).returning();
  return row;
}

/**
 * Administrative password reset (admin-only in higher layers). Stores the
 * given bcrypt hash as-is; callers hash with their own policy.
 */
export async function setJoinCodeHash(db: Db, joinCodeHash: string, now: number): Promise<void> {
  await db
    .update(settings)
    .set({ joinCodeHash, updatedAt: now })
    .where(eq(settings.id, 1));
}

/** The rotation queue (user ids, head = current picker); [] when unset. */
export async function getRotation(db: Db): Promise<number[]> {
  const current = await getSettings(db);
  return parseQueue(current.rotation);
}

/** Overwrite the whole queue (admin reorder, weekly advance, overrides). */
export async function setRotation(db: Db, ids: number[], now: number): Promise<void> {
  await db
    .update(settings)
    .set({ rotation: JSON.stringify(ids), updatedAt: now })
    .where(eq(settings.id, 1));
}

/** The weekly-advance checkpoint (ISO Monday); null = never rotated. */
export async function setLastRotatedWeek(
  db: Db,
  week: string | null,
  now: number,
): Promise<void> {
  await db
    .update(settings)
    .set({ lastRotatedWeek: week, updatedAt: now })
    .where(eq(settings.id, 1));
}
