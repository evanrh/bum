import { scoreStars } from './scale.ts';

// og:image must be an absolute raster URL (Discord: no SVG, ≥ 200×200) and
// og:description truncates near ~350 chars there — hence the cap of 250.
// The origin always comes from astro `site`: the node adapter rewrites
// request origins away (issue #16), so Astro.url can never mint them.
const MAX_DESCRIPTION = 250;

export const FALLBACK_BLURB =
  'A weekly album review club: one pick each week, everyone rates it.';

export type FeaturedAlbum = {
  weekStart: string;
  title: string;
  artist: string;
  submitterName: string;
  avgScore: number | null;
  ratingCount: number;
};

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

// Code-point-safe: surrogate pairs survive truncation.
function capForEmbed(text: string): string {
  if (text.length <= MAX_DESCRIPTION) return text;
  return Array.from(text).slice(0, MAX_DESCRIPTION - 1).join('') + '…';
}

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

export function ogImage(input: { coverUrl: string | null | undefined; origin: string }): string {
  const raw = input.coverUrl ?? '';
  if (raw === '') return joinUrl(input.origin, '/icon.png');
  if (/^https?:\/\//i.test(raw)) return raw;
  return joinUrl(input.origin, raw.startsWith('/') ? raw : `/${raw}`);
}
