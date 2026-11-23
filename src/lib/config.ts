/**
 * Runtime deployment config (issue #39): `SITE_URL` is required at runtime,
 * not at build time. It is validated once at container startup (the boot
 * entrypoint, before any action) and derived per request for OG links —
 * nothing is baked into the build.
 */

/**
 * Parse and validate the configured public origin. Blank → "required"
 * error; anything non-absolute or off-scheme → "absolute http(s)" error.
 * Paths/ports/trailing slashes are tolerated (origin is what matters).
 */
export function parseSiteUrl(raw: string | undefined | null): URL {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') {
    throw new Error(
      '[bum] SITE_URL is required at runtime — the public origin used for OG links. ' +
        'Set it in the environment (e.g. docker run -e SITE_URL=https://bum.example.com …).',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`[bum] SITE_URL must be an absolute http(s) URL, got ${JSON.stringify(trimmed)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `[bum] SITE_URL must be an absolute http(s) URL — ${JSON.stringify(trimmed)} has no valid scheme`,
    );
  }
  return parsed;
}

/** Just the origin (scheme://host[:port]) resolved from the environment. */
export function siteOrigin(raw: string | undefined | null = process.env.SITE_URL): string {
  return parseSiteUrl(raw).origin;
}
