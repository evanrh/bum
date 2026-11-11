import { describe, expect, it } from 'vitest';

import type { User } from '../../src/db/schema.ts';
import { ApiError } from '../../src/lib/errors.ts';
import { requireActiveUser, requireAdmin, requireUser } from '../../src/lib/permissions.ts';

const member: User = {
  id: 1,
  username: 'bob',
  passwordHash: 'h',
  displayName: 'Bob',
  isAdmin: false,
  isActive: true,
  joinedAt: 0,
};
const admin: User = { ...member, id: 2, username: 'admin', isAdmin: true };
const deactivated: User = { ...member, id: 3, username: 'gone', isActive: false };

const asLocals = (user: User | null) => ({ user });

describe('permission matrix', () => {
  it('anonymous → 401 on every guard', () => {
    for (const guard of [requireUser, requireActiveUser, requireAdmin]) {
      try {
        guard(asLocals(null));
        expect.fail(`${guard.name} should have thrown`);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(401);
      }
    }
  });

  it('active member → user/active pass, admin 403', () => {
    expect(requireUser(asLocals(member)).id).toBe(member.id);
    expect(requireActiveUser(asLocals(member)).id).toBe(member.id);
    try {
      requireAdmin(asLocals(member));
      expect.fail('requireAdmin should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(403);
    }
  });

  it('deactivated member → 403 from requireActiveUser', () => {
    expect(requireUser(asLocals(deactivated)).id).toBe(deactivated.id);
    try {
      requireActiveUser(asLocals(deactivated));
      expect.fail('requireActiveUser should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).message).toBe('account deactivated');
    }
  });

  it('admin passes all guards and is returned', () => {
    expect(requireUser(asLocals(admin)).isAdmin).toBe(true);
    expect(requireActiveUser(asLocals(admin)).isAdmin).toBe(true);
    expect(requireAdmin(asLocals(admin)).isAdmin).toBe(true);
  });
});
