import { ApiError } from '../errors.ts';

/** Request-body plumbing shared by the API handlers (JSON + no-JS forms). */

export const isFormPost = (request: Request): boolean =>
  (request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');

/**
 * Accept JSON bodies and `x-www-form-urlencoded` bodies (the no-JS HTML
 * form path). Anything else — or unparseable JSON — is a 400.
 */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    if (isFormPost(request)) {
      const form = await request.formData();
      return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
    }
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'invalid request body');
  }
}

export const redirect = (location: string, cookie?: string): Response => {
  const headers = new Headers({ location });
  if (cookie) headers.set('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
};
