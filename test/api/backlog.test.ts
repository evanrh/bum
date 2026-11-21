import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../../src/db/index.ts';
import {
  createBacklogItem,
  deleteBacklogItem,
  listBacklog,
  orderBacklog,
  toggleAutoQueue,
} from '../../src/lib/api/backlog.ts';
import * as backlogRepo from '../../src/db/repos/backlog.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import { sessionCookie } from '../../src/lib/auth.ts';
import { sessionStore } from '../../src/lib/sessions.ts';
import { makeDb, seedMembers, type FixtureMembers } from '../db/helpers.ts';

const envBackup: { bootstrap?: string } = {};
let db: Db;
let members: FixtureMembers;
let bobCookie: string;
let admin: NonNullable<Awaited<ReturnType<typeof usersRepo.getUserById>>>;
const now = 2_000_000;

const request = (method: string, path: string, body?: unknown, cookie: string | null = bobCookie): Request =>
  new Request(`http://localhost:4321${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(async () => {
  envBackup.bootstrap = process.env.BOOTSTRAP_JOIN_CODE;
  process.env.BOOTSTRAP_JOIN_CODE = 'JOINCODE123';
  db = makeDb();
  members = await seedMembers(db);
  const loaded = await usersRepo.getUserById(db, members.admin.id);
  if (!loaded) throw new Error('fixture user vanished');
  admin = loaded;
  const { token } = sessionStore.create(members.bob.id, Date.now());
  bobCookie = sessionCookie(token, false);
});

describe('backlog endpoints', () => {
  it('anonymous → 401 everywhere', async () => {
    expect((await listBacklog(db, null)).status).toBe(401);
    expect((await createBacklogItem(request('POST', '/api/backlog', { title: 'X', artist: 'Y' }), db, null)).status).toBe(401);
    expect((await deleteBacklogItem(request('DELETE', '/api/backlog/nope'), db, null)).status).toBe(401);
    expect((await orderBacklog(request('POST', '/api/backlog/order', { ids: [] }), db, null)).status).toBe(401);
    expect((await toggleAutoQueue(request('POST', '/api/backlog/auto-queue', { enabled: true }), db, null)).status).toBe(401);
  });

  it('add → 201, list → the item, delete → 204 then 404', async () => {
    const created = await createBacklogItem(
      request('POST', '/api/backlog', { title: 'Blue Train', artist: 'John Coltrane', year: 1957 }),
      db,
      admin,
    );
    expect(created.status).toBe(201);
    const item = (await created.json()) as { id: string; title: string; year: number };
    expect(item).toMatchObject({ title: 'Blue Train', year: 1957 });

    const list = await listBacklog(db, admin);
    expect((await list.json()) as { items: Array<{ id: string }> }).toMatchObject({ items: [item] });

    const removed = await deleteBacklogItem(request('DELETE', `/api/backlog/${item.id}`), db, admin);
    expect(removed.status).toBe(204);
    expect((await backlogRepo.listBacklogItems(db, members.admin.id))).toHaveLength(0);
    expect((await deleteBacklogItem(request('DELETE', `/api/backlog/${item.id}`), db, admin)).status).toBe(404);
  });

  it('members queue only for themselves; bad bodies → 400', async () => {
    const created = await createBacklogItem(
      request('POST', '/api/backlog', { title: 'Mine', artist: 'Me' }),
      db,
      admin,
    );
    const item = (await created.json()) as { id: string };

    // Each member sees only their own queue.
    const bob = await usersRepo.getUserById(db, members.bob.id);
    expect(bob).toBeDefined();
    const bobBody = (await (await listBacklog(db, bob!)).json()) as { items: Array<{ id: string }> };
    expect(bobBody.items).toEqual([]);
    expect(((await backlogRepo.listBacklogItems(db, members.admin.id))[0].id)).toBe(item.id);

    expect((await orderBacklog(request('POST', '/api/backlog/order', { ids: [item.id, 'ghost'] }), db, admin)).status).toBe(400);
    expect((await orderBacklog(request('POST', '/api/backlog/order', { ids: [item.id] }), db, admin)).status).toBe(200);
    expect((await toggleAutoQueue(request('POST', '/api/backlog/auto-queue', { enabled: false }), db, admin)).status).toBe(200);
    expect((await toggleAutoQueue(request('POST', '/api/backlog/auto-queue', { enabled: 'yes' }), db, admin)).status).toBe(400);
    expect((await createBacklogItem(request('POST', '/api/backlog', { title: '', artist: '' }), db, admin)).status).toBe(400);
  });
});
