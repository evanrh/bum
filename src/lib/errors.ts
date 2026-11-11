/**
 * API error convention — see plans/README.md: every endpoint replies
 * errors as `{ error: string }` with the right HTTP status.
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Map any thrown value to a JSON error Response. ApiErrors keep their
 * status + message; anything unexpected becomes a generic 500 (never
 * leak internals to the client).
 */
export function jsonError(error: unknown): Response {
  if (error instanceof ApiError) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  console.error('[bum:api] unhandled endpoint error:', error);
  return new Response(JSON.stringify({ error: 'internal server error' }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
}
