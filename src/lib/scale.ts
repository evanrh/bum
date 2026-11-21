/**
 * Rating-scale display (issue #28): the stored integer is **half-stars × 2**
 * (locked data model: 1–10 = 0.5–5 stars), but the UI's star widgets depict a
 * 5-star scale. Every user-facing *number* must therefore be shown in star
 * units, never as the raw stored value — a stored average of 7.3 means 3.7★.
 */

/**
 * Star-unit text for a stored score (half-stars × 2) or stored average,
 * with the ★ marker: 7 → "3.5★", 7.3 → "3.7★", 6 → "3★". Null/undefined →
 * the dash the pages previously showed for unrated albums.
 */
export function scoreStars(score10: number | null | undefined): string {
  if (score10 === null || score10 === undefined) return '—';
  const stars = score10 / 2;
  const rounded = Math.round(stars * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}★`;
}
