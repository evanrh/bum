import { describe, expect, it } from 'vitest';

import { ApiError, jsonError } from '../../src/lib/errors.ts';

describe('jsonError', () => {
  it('maps ApiErrors to { error } with their status', async () => {
    const response = jsonError(new ApiError(409, 'username already taken'));
    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ error: 'username already taken' });
  });

  it('maps unexpected errors to a generic 500 (no internals leaked)', async () => {
    const response = jsonError(new Error('secrets in the stack'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal server error' });
  });
});
