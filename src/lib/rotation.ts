/**
 * Rotation engine — pure functions over the queue stored in
 * `settings.rotation` (JSON array of user ids; the head is the current
 * picker). All week ids are ISO Mondays in TIMEZONE — plain calendar
 * arithmetic over the US Eastern wall clock.
 *
 * Implemented per plans/T02-rotation-engine.md. No DB access, no astro
 * imports.
 */

export const TIMEZONE = 'America/New_York';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

type EasternWallClock = { y: number; m: number; d: number; hour: number; minute: number };

const easternFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function easternWallClock(instant: number): EasternWallClock {
  const parts = easternFormatter.formatToParts(instant);
  const byType: Record<string, string> = {};
  for (const part of parts) byType[part.type] = part.value;
  return {
    y: Number(byType.year),
    m: Number(byType.month),
    d: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
  };
}

/** Calendar year/month/day (1-based) of `now` in TIMEZONE. */
export function easternDateParts(now: Date): { y: number; m: number; d: number } {
  const wall = easternWallClock(now.getTime());
  return { y: wall.y, m: wall.m, d: wall.d };
}

function utcFromISO(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Calendar days `a − b` (Date.UTC parts — immune to DST hour shifts). */
export function daysBetweenISO(a: string, b: string): number {
  return Math.round((utcFromISO(a) - utcFromISO(b)) / DAY_MS);
}

export function addWeeksISO(week: string, n: number): string {
  return new Date(utcFromISO(week) + n * 7 * DAY_MS).toISOString().slice(0, 10);
}

/**
 * ISO Monday of the Eastern calendar week containing `now` — the week id.
 * The Eastern calendar date decides everything: DST shifts the clock, never
 * the date, so a "spring forward" week is still 7 calendar days.
 */
export function weekId(now: Date): string {
  const { y, m, d } = easternDateParts(now);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
  const mondayUtc = Date.UTC(y, m - 1, d) - ((weekday + 6) % 7) * DAY_MS;
  return new Date(mondayUtc).toISOString().slice(0, 10);
}

/**
 * The instant of Monday 00:00 in TIMEZONE for the given week id. Eastern
 * offsets are only ever −04:00 (EDT) or −05:00 (EST), so seeding the EDT
 * candidate `Date.UTC(y, m−1, d, 4)` lands within one hour of the truth;
 * correct it by reading back the Eastern wall clock. This is the only
 * DST-aware code in the app.
 */
export function weekStartsAt(week: string): Date {
  const [y, m, d] = week.split('-').map(Number);
  let instant = Date.UTC(y, m - 1, d, 4);
  for (let attempt = 0; attempt < 3; attempt++) {
    const wall = easternWallClock(instant);
    if (wall.y === y && wall.m === m && wall.d === d && wall.hour === 0 && wall.minute === 0) {
      break;
    }
    // EDT candidate read back as 23:00 the day before → we are in EST, +1h.
    instant += wall.hour === 23 ? HOUR_MS : -HOUR_MS;
  }
  return new Date(instant);
}

/** Parse the `settings.rotation` JSON column — tolerant of junk → []. */
export function parseQueue(json: string | number[] | null): number[] {
  if (Array.isArray(json)) return json.filter((id): id is number => typeof id === 'number');
  if (typeof json !== 'string' || json.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => typeof id === 'number');
  } catch {
    return [];
  }
}

/**
 * Advance the rotation: pop the head off and append it at the back — the
 * next member immediately becomes the picker. Empty queue → no-op.
 * Returns the new queue and the member that was moved (null with an empty
 * queue; a single-member queue is a compositional no-op).
 */
export function rotateQueue(queue: number[]): { queue: number[]; moved: number | null } {
  if (queue.length === 0) return { queue: [], moved: null };
  const [head, ...rest] = queue;
  return { queue: [...rest, head], moved: head };
}

/**
 * How many weekly advances are pending: elapsed calendar weeks between the
 * checkpoint and the current week. A null checkpoint means "never rotated" —
 * the caller bootstraps by setting it to the current week without rotating.
 * A future checkpoint (restored backup) counts as zero.
 */
export function pendingAdvances(lastRotatedWeek: string | null, currentWeek: string): number {
  if (lastRotatedWeek === null) return 0;
  const diff = daysBetweenISO(currentWeek, lastRotatedWeek);
  return diff > 0 ? Math.floor(diff / 7) : 0;
}

/** The app-facing turn snapshot: everything downstream needs is here. */
export function currentTurn(
  settings: { rotation: string | number[] | null },
  now: Date,
): { week: string; pickerId: number | null; startedAt: Date; endsAt: Date } {
  const queue = parseQueue(settings.rotation);
  const week = weekId(now);
  return {
    week,
    pickerId: queue[0] ?? null,
    startedAt: weekStartsAt(week),
    endsAt: weekStartsAt(addWeeksISO(week, 1)),
  };
}
