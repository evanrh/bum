import { useRef, useState, type ReactNode } from 'react';

import type { MyRatingRow } from '../../db/repos/ratings.ts';
import { relativeTime } from '../../lib/dashboard.ts';
import { scoreStars } from '../../lib/scale.ts';
import { Show } from '../react/Show.tsx';
import { Switch } from '../react/Switch.tsx';
import { Match } from '../react/Match.tsx';

export type ProfileRatingsProps = {
  rows: MyRatingRow[];
  /** Page-render time (Date.now() ms) — pins relative times for everyone. */
  now: number;
};

export type SortField = 'created' | 'score';
export type SortDirection = 'asc' | 'desc';
export type SortState = { field: SortField; direction: SortDirection };

const FIELD_DEFAULTS: Record<SortField, SortDirection> = { created: 'desc', score: 'desc' };

const FIELDS: Array<{ id: SortField; label: string }> = [
  { id: 'created', label: 'date created' },
  { id: 'score', label: 'rating' },
];

function Chevron({ direction }: { direction: SortDirection }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid={`chevron-${direction}`}
    >
      {/* down = descending (default), up = ascending */}
      <path d={direction === 'desc' ? 'm4 6 4 4 4-4' : 'm4 10 4-4 4 4'} />
    </svg>
  );
}

/** StarDisplay.astro's twin for the island row — the fill width is inline CSS. */
function RowStars({ score10 }: { score10: number }): ReactNode {
  const pct = Math.round((score10 / 10) * 100);
  return (
    <span
      className="star-display relative inline-flex align-middle leading-none text-sm"
      role="img"
      aria-label={`${score10 / 2} stars`}
    >
      <span aria-hidden="true" className="text-zinc-700">★★★★★</span>
      <span
        aria-hidden="true"
        className="star-display-fill absolute left-0 top-0 overflow-hidden whitespace-nowrap text-amber-400"
        style={{ width: `${pct}%` }}
      >★★★★★</span>
    </span>
  );
}

function RatingRow({ row, now }: { row: MyRatingRow; now: number }): ReactNode {
  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <a
          className="text-sm font-medium text-zinc-200 hover:underline"
          href={`/albums/${row.albumId}`}
        >
          {row.albumTitle}
        </a>
        <span className="flex shrink-0 items-center gap-2">
          <RowStars score10={row.score} />
          <span className="text-xs text-zinc-500">{scoreStars(row.score)}</span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          {row.albumArtist}
          {row.albumYear !== null ? ` (${row.albumYear})` : ''}
        </p>
        <span className="shrink-0 text-xs text-zinc-600">
          rated {relativeTime(row.createdAt, now)}
        </span>
      </div>
      <Show when={row.comment}>
        <p className="rounded bg-zinc-950 px-3 py-2 text-sm italic text-zinc-300">“{row.comment}”</p>
      </Show>
    </li>
  );
}

/**
 * /profile ratings list (issues #54/#56): sort state lives entirely in client
 * state — the URL is never read or written and fresh loads start at date
 * created descending — but every toggle re-fetches from `GET /api/ratings`
 * and renders the server-sorted response as-is, so ordering lives at the SQL
 * boundary (pagination rides on this later). Rows arrive initially from the
 * .astro shell; a toggle keeps the previous list visible until the fetch
 * lands (stale responses from rapid re-toggles are dropped).
 */
export function ProfileRatings({ rows: initialRows, now }: ProfileRatingsProps): ReactNode {
  const [sort, setSort] = useState<SortState>({ field: 'created', direction: 'desc' });
  const [rows, setRows] = useState(initialRows);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState('');
  // Staleness guard: only the most recent toggle's response may land.
  const requestRef = useRef(0);

  const toggle = (field: SortField): void => {
    const next: SortState =
      sort.field === field
        ? { field, direction: sort.direction === 'desc' ? 'asc' : 'desc' }
        : { field, direction: FIELD_DEFAULTS[field] };
    setSort(next);
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setInFlight(true);
    setError('');
    void fetch(`/api/ratings?sort=${next.field}&dir=${next.direction}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`re-sort failed (${response.status})`);
        return (await response.json()) as { rows: MyRatingRow[] };
      })
      .then((payload) => {
        if (requestRef.current === requestId) {
          setRows(payload.rows);
          setInFlight(false);
        }
      })
      .catch(() => {
        if (requestRef.current === requestId) {
          setError('re-sort failed — try again');
          setInFlight(false);
        }
      });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="sort your ratings">
        {FIELDS.map(({ id, label }) => {
          const active = id === sort.field;
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              aria-current={active ? 'true' : undefined}
              className={
                active
                  ? 'flex items-center gap-1.5 rounded bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-900'
                  : 'flex items-center gap-1.5 rounded px-3 py-1 text-sm text-zinc-400 hover:text-zinc-200'
              }
            >
              {label}
              <Show when={active}>
                <Chevron direction={sort.direction} />
              </Show>
            </button>
          );
        })}
      </div>
      <Show when={error}>
        <p className="text-xs text-red-300" role="alert">{error}</p>
      </Show>
      <Switch>
        <Match when={rows.length === 0}>
          <p className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-6 text-sm text-zinc-500">
            no ratings yet — open an album and give it a score.
          </p>
        </Match>
        <Match when={rows.length > 0}>
          <ul
            className={
              inFlight
                ? 'divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900 opacity-60 transition-opacity'
                : 'divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900'
            }
            data-testid="ratings-list"
            data-in-flight={inFlight ? 'true' : undefined}
          >
            {rows.map((row) => (
              <RatingRow key={row.id} row={row} now={now} />
            ))}
          </ul>
        </Match>
      </Switch>
    </div>
  );
}

export default ProfileRatings;
