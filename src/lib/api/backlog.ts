import type { Db } from '../../db/index.ts';
import * as backlogRepo from '../../db/repos/backlog.ts';
import type { User } from '../../db/schema.ts';
import { addBacklogItem, reorderBacklog, removeBacklogItem, setAutoQueue } from '../backlog.ts';
import { ApiError, jsonError } from '../errors.ts';
import { readBody } from './http.ts';

/**
 * Backlog endpoints (issue #18) — handlers are pure Request→Response over an
 * injected db; errors follow the plans/README.md `{ error }` convention.
 * Everything is scoped to the signed-in member's own queue.
 */

export async function listBacklog(db: Db, user: User | null): Promise<Response> {
  try {
    if (!user) throw new ApiError(401, 'authentication required');
    if (!user.isActive) throw new ApiError(403, 'account deactivated');
    return new Response(JSON.stringify({ items: await backlogRepo.listBacklogItems(db, user.id) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function createBacklogItem(request: Request, db: Db, user: User | null): Promise<Response> {
  try {
    if (!user) throw new ApiError(401, 'authentication required');
    const item = await addBacklogItem(user, db, await readBody(request), { fetch: fetch.bind(globalThis) });
    return new Response(JSON.stringify(item), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function deleteBacklogItem(request: Request, db: Db, user: User | null): Promise<Response> {
  try {
    if (!user) throw new ApiError(401, 'authentication required');
    const id = new URL(request.url).pathname.split('/').at(-1);
    if (!id) throw new ApiError(400, 'backlog item id is required');
    await removeBacklogItem(user, db, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function orderBacklog(request: Request, db: Db, user: User | null): Promise<Response> {
  try {
    if (!user) throw new ApiError(401, 'authentication required');
    const items = await reorderBacklog(user, db, await readBody(request));
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function toggleAutoQueue(request: Request, db: Db, user: User | null): Promise<Response> {
  try {
    if (!user) throw new ApiError(401, 'authentication required');
    const updated = await setAutoQueue(user, db, await readBody(request));
    return new Response(JSON.stringify({ autoBacklog: updated.autoBacklog }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}
