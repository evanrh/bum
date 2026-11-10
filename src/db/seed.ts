import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';

import { applyMigrations } from './migrate.ts';
import { createDatabase, type Db } from './index.ts';
import * as usersRepo from './repos/users.ts';
import * as albumsRepo from './repos/albums.ts';
import * as ratingsRepo from './repos/ratings.ts';
import * as settingsRepo from './repos/settings.ts';
import {
  albums,
  ratings,
  settings,
  skippedTurns,
  users,
} from './schema.ts';

const BCRYPT_COST = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

const credentials = [
  { username: 'admin', password: 'bumadmin1', isAdmin: true, displayName: 'Evan (Admin)' },
  { username: 'bob', password: 'bumbob1', isAdmin: false, displayName: 'Bob' },
  { username: 'carol', password: 'bumcarol1', isAdmin: false, displayName: 'Carol' },
  { username: 'dave', password: 'bumdave1', isAdmin: false, displayName: 'Dave' },
];

export type SeedOptions = { force?: boolean };

export type SeedResult = {
  joinCode: string;
  users: Array<{ username: string; password: string; isAdmin: boolean; displayName: string }>;
  albums: Array<{ title: string; artist: string; submitter: string; weekStart: string }>;
  ratingCount: number;
};

/**
 * Populate a database with demo data: settings (with a *known* join code),
 * an admin, three members, and two past albums with ratings. Deterministic:
 * timestamps/weeks are derived from Date.now() so the rotation history looks
 * real relative to whenever it runs.
 *
 * Refuses to touch a database that already has users unless `force`.
 */
export async function seed(db: Db, opts: SeedOptions = {}): Promise<SeedResult | null> {
  const existingUsers = await usersRepo.countUsers(db);
  if (existingUsers > 0 && !opts.force) {
    return null;
  }
  if (existingUsers > 0 && opts.force) {
    // Deterministic reseed — wipe in FK-safe order.
    await db.delete(ratings);
    await db.delete(albums);
    await db.delete(skippedTurns);
    await db.delete(users);
    await db.delete(settings);
  }
  return seedFresh(db);
}

async function seedFresh(db: Db): Promise<SeedResult> {
  // Known join code: SEED_JOIN_CODE wins, then any BOOTSTRAP_JOIN_CODE pin.
  // We pin the code through the bootstrap env var so getSettings() uses it,
  // then restore the environment (this function runs in tests too).
  const previousEnv = process.env.BOOTSTRAP_JOIN_CODE;
  const joinCode = (process.env.SEED_JOIN_CODE ?? previousEnv ?? 'bumseed').trim() || 'bumseed';
  process.env.BOOTSTRAP_JOIN_CODE = joinCode;
  try {
    await settingsRepo.getSettings(db);
  } finally {
    if (previousEnv === undefined) delete process.env.BOOTSTRAP_JOIN_CODE;
    else process.env.BOOTSTRAP_JOIN_CODE = previousEnv;
  }

  const now = Date.now();
  const members: Record<string, { id: number }> = {};
  for (const cred of credentials) {
    const user = await usersRepo.createUser(
      db,
      {
        username: cred.username,
        passwordHash: bcrypt.hashSync(cred.password, BCRYPT_COST),
        displayName: cred.displayName,
        isAdmin: cred.isAdmin,
      },
      now,
    );
    members[cred.username] = { id: user.id };
  }

  const mondayTwoWeeksAgo = settingsRepo.utcMondayISO(now - 14 * DAY_MS);
  const mondayLastWeek = settingsRepo.utcMondayISO(now - 7 * DAY_MS);

  const jazzWeek = await albumsRepo.insertAlbum(db, {
    title: 'Kind of Blue',
    artist: 'Miles Davis',
    year: 1959,
    submittedBy: members.carol.id,
    submittedAt: now - 13 * DAY_MS,
    weekStart: mondayTwoWeeksAgo,
    spotifyId: '1weenld61qoidwYuZ1GESA',
    note: 'The modal jazz blueprint. Still unbeatable on a rainy Sunday.',
  });
  if (!jazzWeek.ok) throw new Error(`seed album 1 failed: ${jazzWeek.reason}`);

  const progWeek = await albumsRepo.insertAlbum(db, {
    title: 'In the Court of the Crimson King',
    artist: 'King Crimson',
    year: 1969,
    submittedBy: members.dave.id,
    submittedAt: now - 6 * DAY_MS,
    weekStart: mondayLastWeek,
    youtubeId: 'f27gQXSnU0M',
    note: 'Prog rock ground zero. Bring headphones.',
  });
  if (!progWeek.ok) throw new Error(`seed album 2 failed: ${progWeek.reason}`);

  // Full rating sets, with Dave having skipped rating the prog record.
  const ratingRows: Array<{ albumId: string; who: string; score: number; comment?: string; at: number }> = [
    { albumId: jazzWeek.album.id, who: 'admin', score: 9, comment: 'So What alone is worth the price.', at: now - 12 * DAY_MS },
    { albumId: jazzWeek.album.id, who: 'bob', score: 8, comment: 'Smooth as advertised.', at: now - 12 * DAY_MS },
    { albumId: jazzWeek.album.id, who: 'carol', score: 9, at: now - 11 * DAY_MS },
    { albumId: jazzWeek.album.id, who: 'dave', score: 7, comment: 'Great, but it naps in the second half.', at: now - 11 * DAY_MS + 60000 },
    { albumId: progWeek.album.id, who: 'admin', score: 8, at: now - 5 * DAY_MS },
    { albumId: progWeek.album.id, who: 'bob', score: 6, comment: 'Mellotron everywhere. Some of it earned.', at: now - 5 * DAY_MS },
    { albumId: progWeek.album.id, who: 'dave', score: 10, comment: 'Perfect.', at: now - 5 * DAY_MS + 60000 },
  ];
  for (const r of ratingRows) {
    await ratingsRepo.upsertRating(
      db,
      { albumId: r.albumId, userId: members[r.who].id, score: r.score, comment: r.comment },
      r.at,
    );
  }
  const [countRow] = await db.select({ n: sql<number>`count(*)` }).from(ratings);

  return {
    joinCode,
    users: credentials.map(({ username, password, isAdmin, displayName }) => ({
      username,
      password,
      isAdmin,
      displayName,
    })),
    albums: [
      { title: 'Kind of Blue', artist: 'Miles Davis', submitter: 'carol', weekStart: mondayTwoWeeksAgo },
      {
        title: 'In the Court of the Crimson King',
        artist: 'King Crimson',
        submitter: 'dave',
        weekStart: mondayLastWeek,
      },
    ],
    ratingCount: Number(countRow.n),
  };
}

const isMainModule = (): boolean => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
};

// CLI entry: `node src/db/seed.ts [--force]`
if (isMainModule()) {
  const force = process.argv.slice(2).includes('--force');
  const db = createDatabase();
  applyMigrations(db);
  const result = await seed(db, { force });
  db.$client.close();
  if (!result) {
    console.log('[bum] seed refused: database already has users (pass --force to wipe and reseed)');
    process.exit(1);
  }
  console.log('[bum] seed complete:');
  console.log(`  join code: ${result.joinCode}`);
  for (const user of result.users) {
    console.log(
      `  ${user.isAdmin ? 'admin ' : 'member'} ${user.username} / ${user.password}  (${user.displayName})`,
    );
  }
  for (const album of result.albums) {
    console.log(`  album   ${album.title} — ${album.artist} (week ${album.weekStart}, by ${album.submitter})`);
  }
  console.log(`  ratings: ${result.ratingCount}`);
}
