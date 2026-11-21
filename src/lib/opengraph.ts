import { scoreStars } from './scale.ts';

/**
 * OpenGraph embed helpers (issue #31). Framework-agnostic: callers pass
 * the config-guaranteed `Astro.site` origin in — `Astro.url`'s origin is
 * never usable (the node adapter rewrites request origins away, issue
 * #16), pathname is fine.
 *
 * Discord notes baked into these rules: og:image must be an absolute
 * raster URL (SVG unsupported, ≥200×200, ≤8MB); og:description truncates
 * near ~350 chars, so 250 leaves headroom.
 */

/** Hard cap for the embed blurb (Discord truncates ~350 chars). */
const MAX_DESCRIPTION = 250;

/** Blurb when the club has nothing to show yet (no album, no rotation). */
export const FALLBACK_BLURB =
  'A weekly album review club: one pick each week, everyone rates it.';

/** The bits of a featured album that shape the embed text. */
export type FeaturedAlbum = {
  /** ISO Monday of the album's week (falls back to no week prefix). */
  weekStart: string;
  title: string;
  artist: string;
  submitterName: string;
  /** Stored average score (half-stars × 2) or null when unrated. */
  avgScore: number | null;
  ratingCount: number;
};

/**
 * Join a path onto the configured public origin. Throws (instead of
 * returning a relative URL) when the origin is malformed — §1 of issue
 * #31 makes that impossible in practice; this is the loud backstop.
 */
export function joinUrl(origin: string, path: string): string {
  try {
    return new URL(path, origin).toString();
  } catch (cause) {
    throw new Error(
      `[bum] SITE_URL is misconfigured (${JSON.stringify(origin)}) — cannot build an absolute URL for ${path}`,
      { cause },
    );
  }
}

/**
 * Truncate past the cap, code-point-safe (surrogate pairs survive).
 * The ellipsis counts against the cap.
 */
function capForEmbed(text: string): string {
  if (text.length <= MAX_DESCRIPTION) return text;
  return Array.from(text).slice(0, MAX_DESCRIPTION - 1).join('') + '…';
}

/**
 * The dynamic embed blurb for the main page, in order:
 * 1. a featured album → (week prefix when it's this week's pick)
 *    "Title" by Artist, picked by Name. — plus the average in star
 *    units (issue #28) and the rating count when anyone rated it;
 * 2. else, a picker on rotation → whose turn it is;
 * 3. else the static fallback blurb.
 */
export function ogDescription(input: {
  week: string;
  pickerName: string | null;
  featured: FeaturedAlbum | null;
}): string {
  const { week, pickerName, featured } = input;
  let text: string;
  if (featured) {
    const weekPrefix = featured.weekStart === week ? `Week of ${week} — ` : '';
    const ratings =
      featured.ratingCount > 0 && featured.avgScore !== null
        ? ` ${scoreStars(featured.avgScore)} from ${featured.ratingCount} ratings.`
        : '';
    text = `${weekPrefix}“${featured.title}” by ${featured.artist}, picked by ${featured.submitterName}.${ratings}`;
  } else if (pickerName !== null && pickerName.length > 0) {
    text = `Week of ${week} — ${pickerName}'s turn to pick.`;
  } else {
    text = FALLBACK_BLURB;
  }
  return capForEmbed(text);
}

/**
 * The embed image URL: an absolute cover URL passes through untouched,
 * relative images resolve against the origin, and nothing at all falls
 * back to the site icon `/icon.png` (the favicon doubles as the fallback
 * og:image — locked decision, issue #31).
 */
export function ogImage(input: { coverUrl: string | null | undefined; origin: string }): string {
  const raw = input.coverUrl ?? '';
  if (raw === '') return joinUrl(input.origin, '/icon.png');
  if (/^https?:\/\//i.test(raw)) return raw;
  return joinUrl(input.origin, raw.startsWith('/') ? raw : `/${raw}`);
}
