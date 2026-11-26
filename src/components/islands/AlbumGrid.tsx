import { useRef, useState, type ReactNode } from 'react';

import type { AlbumWithStats } from '../../db/repos/albums.ts';
import { scoreStars } from '../../lib/scale.ts';
import { Show } from '../react/Show.tsx';

export type AlbumSort = 'newest' | 'avg';

export type AlbumGridProps = {
  /** Initial rows from the .astro shell, in the fixed default order (newest). */
  albums: AlbumWithStats[];
  /** URL state the shell rendered with — every re-fetch must carry it. */
  by?: number;
  page: number;
};

/** StarDisplay.astro's twin — a null average stays the dimmed "not rated" scale. */
function GridStars({ avgScore }: { avgScore: number | null }): ReactNode {
  const pct = avgScore ? Math.round((avgScore / 10) * 100) : 0;
  return (
    <span
      className="star-display relative inline-flex align-middle leading-none text-sm"
      role="img"
      aria-label={avgScore ? `${avgScore / 2} stars` : 'not rated'}
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

function GridCard({ album }: { album: AlbumWithStats }): ReactNode {
  return (
    <a
      href={`/albums/${album.id}`}
      className="album-card block overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-600"
    >
      <Show
        when={album.coverUrl}
        fallback={
          <div
            className="album-card-fallback aspect-square w-full bg-gradient-to-br from-zinc-800 via-zinc-800 to-zinc-900"
            aria-hidden="true"
          />
        }
      >
        <img
          src={album.coverUrl ?? undefined}
          alt={`cover of ${album.title}`}
          loading="lazy"
          className="aspect-square w-full object-cover"
        />
      </Show>
      <div className="p-4">
        <h3 className="font-medium text-zinc-100">{album.title}</h3>
        <p className="text-sm text-zinc-400">{album.artist}</p>
        <p className="mt-1 text-xs text-zinc-500">week of {album.weekStart} — {album.submitterName ?? 'unknown'}</p>
        <div className="mt-2 flex items-center gap-2">
          <GridStars avgScore={album.avgScore} />
          <span className="text-xs text-zinc-400">{scoreStars(album.avgScore)}</span>
          <span className="text-xs text-zinc-500">({album.ratingCount})</span>
        </div>
      </div>
    </a>
  );
}

/**
 * The /albums grid (issue #62): sort state lives entirely in client state —
 * the URL is never read or written, and fresh loads start at newest — but
 * every toggle re-fetches from `GET /api/albums` carrying the shell's
 * by/page and renders the response as-is, so ordering stays at the SQL
 * boundary. Rows arrive initially from the .astro shell; a toggle keeps the
 * previous grid visible until the fetch lands (stale responses from rapid
 * re-toggles are dropped).
 */
export function AlbumGrid({ albums: initialAlbums, by, page }: AlbumGridProps): ReactNode {
  const [albums, setAlbums] = useState(initialAlbums);
  const [sort, setSort] = useState<AlbumSort>('newest');
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState('');
  // Staleness guard: only the most recent toggle's response may land.
  const requestRef = useRef(0);

  const reSort = (next: AlbumSort): void => {
    setSort(next);
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setInFlight(true);
    setError('');
    const params = new URLSearchParams();
    if (by !== undefined) params.set('by', String(by));
    if (page > 1) params.set('page', String(page));
    params.set('sort', next);
    void fetch(`/api/albums?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`re-sort failed (${response.status})`);
        return (await response.json()) as { items: AlbumWithStats[] };
      })
      .then((payload) => {
        if (requestRef.current === requestId) {
          setAlbums(payload.items);
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

  const sortButton = (value: AlbumSort, label: string): ReactNode => (
    <button
      type="button"
      onClick={() => reSort(value)}
      className={
        sort === value
          ? 'cursor-pointer rounded bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-900'
          : 'cursor-pointer rounded px-3 py-1 text-sm text-zinc-400 hover:text-zinc-200'
      }
      aria-pressed={sort === value}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="sort albums">
        {sortButton('newest', 'newest')}
        {sortButton('avg', 'highest rated')}
      </div>
      <Show when={error}>
        <p className="text-xs text-red-300" role="alert">{error}</p>
      </Show>
      <Show
        when={albums.length > 0}
        fallback={
          <p className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-6 text-sm text-zinc-500">
            nothing here yet.
          </p>
        }
      >
        <div
          className={
            inFlight
              ? 'grid grid-cols-2 gap-4 opacity-60 transition-opacity sm:grid-cols-3'
              : 'grid grid-cols-2 gap-4 sm:grid-cols-3'
          }
          data-testid="album-grid"
          data-in-flight={inFlight ? 'true' : undefined}
        >
          {albums.map((album) => (
            <GridCard key={album.id} album={album} />
          ))}
        </div>
      </Show>
    </div>
  );
}

export default AlbumGrid;
