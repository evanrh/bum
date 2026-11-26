// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { AlbumGrid, type AlbumGridProps } from '../../src/components/islands/AlbumGrid.tsx';
import type { AlbumWithStats } from '../../src/db/repos/albums.ts';

const baseAlbum = (
  overrides: Partial<AlbumWithStats> & Pick<AlbumWithStats, 'id' | 'title'>,
): AlbumWithStats => ({
  artist: 'some artist',
  year: null,
  submittedBy: 7,
  submittedAt: 1,
  weekStart: '2026-01-05',
  spotifyId: null,
  youtubeId: null,
  coverUrl: null,
  note: null,
  avgScore: null,
  ratingCount: 0,
  submitterName: 'bob',
  ...overrides,
});

// In the server's default order (submittedAt descending). Second Album has
// cover + ratings + a null submitter, exercising every card slot.
const ALBUMS: AlbumWithStats[] = [
  baseAlbum({ id: 'al-3', title: 'Third Album', artist: 'Artist Three', weekStart: '2026-01-19', submitterName: 'carol' }),
  baseAlbum({
    id: 'al-2',
    title: 'Second Album',
    artist: 'Artist Two',
    weekStart: '2026-01-12',
    avgScore: 9,
    ratingCount: 2,
    coverUrl: 'https://example.com/c2.jpg',
  }),
  baseAlbum({ id: 'al-1', title: 'First Album', artist: 'Artist One', submitterName: null }),
];

const renderIsland = (props: Partial<AlbumGridProps> = {}): void => {
  render(<AlbumGrid albums={props.albums ?? ALBUMS} by={props.by} page={props.page ?? 1} />);
};

const renderedTitles = (): string[] =>
  screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

const sortButton = (label: 'newest' | 'highest rated'): HTMLButtonElement =>
  screen.getByRole('button', { name: label }) as HTMLButtonElement;

const ok = (items: AlbumWithStats[]): Response =>
  new Response(JSON.stringify({ items, total: items.length }), { status: 200, headers: { 'content-type': 'application/json' } });

const deferred = (): { promise: Promise<Response>; resolve: (response: Response) => void } => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // A legacy ?sort= query string exercises the "client state only" contract:
  // the island ignores the URL entirely and no interaction navigates.
  vi.stubGlobal('location', {
    href: 'http://localhost:4321/albums?sort=avg',
    search: '?sort=avg',
    assign: vi.fn(),
    replace: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<AlbumGrid> sort toggles re-fetch from the server (issue #62)', () => {
  it('fresh load renders the SSR rows as-is and fetches nothing on mount', () => {
    renderIsland();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(renderedTitles()).toEqual(['Third Album', 'Second Album', 'First Album']);
    expect(sortButton('newest').getAttribute('aria-pressed')).toBe('true');
    expect(sortButton('highest rated').getAttribute('aria-pressed')).toBe('false');
  });

  it('cards render in full parity: link, cover or fallback, week — submitter, stars, (count)', () => {
    renderIsland();
    const second = screen.getByRole('heading', { name: 'Second Album' }).closest('a');
    if (second === null) throw new Error('second card vanished');
    expect(second.getAttribute('href')).toBe('/albums/al-2');
    expect(within(second).getByRole('img', { name: 'cover of Second Album' }).getAttribute('src')).toBe(
      'https://example.com/c2.jpg',
    );
    expect(within(second).getByText('4.5★')).toBeTruthy();
    expect(within(second).getByRole('img', { name: '4.5 stars' })).toBeTruthy();
    expect(within(second).getByText('week of 2026-01-12 — bob')).toBeTruthy();
    expect(within(second).getByText('(2)')).toBeTruthy();

    // No cover → the gradient fallback slot; no rated average → the dimmed
    // "not rated" scale and the dash; no submitter row → 'unknown'.
    const first = screen.getByRole('heading', { name: 'First Album' }).closest('a');
    if (first === null) throw new Error('first card vanished');
    expect(first.querySelector('.album-card-fallback')).not.toBeNull();
    expect(within(first).getByRole('img', { name: 'not rated' })).toBeTruthy();
    expect(within(first).getByText('—')).toBeTruthy();
    expect(within(first).getByText('week of 2026-01-05 — unknown')).toBeTruthy();
  });

  it('toggling fetches the selected sort and renders the server response as-is', async () => {
    const serverOrder: AlbumWithStats[] = [
      baseAlbum({ id: 'al-9', title: 'Server First' }),
      baseAlbum({ id: 'al-1', title: 'First Album' }),
    ];
    fetchMock.mockResolvedValue(ok(serverOrder));
    renderIsland();
    fireEvent.click(sortButton('highest rated'));
    expect(fetchMock).toHaveBeenCalledWith('/api/albums?sort=avg');
    await waitFor(() => expect(renderedTitles()).toEqual(['Server First', 'First Album']));
    expect(screen.queryByRole('heading', { name: 'Third Album' })).toBeNull();
  });

  it('the by= and page= props ride along on every re-fetch', async () => {
    fetchMock.mockResolvedValue(ok(ALBUMS));
    renderIsland({ by: 2, page: 3 });
    fireEvent.click(sortButton('highest rated'));
    fireEvent.click(sortButton('newest'));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/albums?by=2&page=3&sort=avg',
      '/api/albums?by=2&page=3&sort=newest',
    ]);
  });

  it('only the active sort is pressed; the choice flips immediately on click', async () => {
    fetchMock.mockResolvedValue(ok(ALBUMS));
    renderIsland();
    expect(sortButton('newest').className).toContain('bg-zinc-100');
    expect(sortButton('highest rated').className).not.toContain('bg-zinc-100');
    fireEvent.click(sortButton('highest rated'));
    expect(sortButton('highest rated').getAttribute('aria-pressed')).toBe('true');
    expect(sortButton('highest rated').className).toContain('bg-zinc-100');
    expect(sortButton('newest').getAttribute('aria-pressed')).toBe('false');
    expect(sortButton('newest').className).not.toContain('bg-zinc-100');
  });

  it('in flight: the previous grid stays visible and dims until the fetch lands', async () => {
    const pending = deferred();
    fetchMock.mockImplementationOnce(() => pending.promise).mockResolvedValue(ok(ALBUMS));
    renderIsland();
    fireEvent.click(sortButton('highest rated'));
    const grid = screen.getByTestId('album-grid');
    expect(grid.getAttribute('data-in-flight')).toBe('true');
    expect(grid.className).toContain('opacity-60');
    expect(renderedTitles()).toEqual(['Third Album', 'Second Album', 'First Album']);
    pending.resolve(ok(ALBUMS));
    await waitFor(() => expect(screen.getByTestId('album-grid').getAttribute('data-in-flight')).toBeNull());
  });

  it('a failed re-fetch keeps the previous rows and reports the error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    renderIsland();
    fireEvent.click(sortButton('highest rated'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('re-sort failed — try again'));
    expect(renderedTitles()).toEqual(['Third Album', 'Second Album', 'First Album']);
    expect(screen.getByTestId('album-grid').getAttribute('data-in-flight')).toBeNull();
  });

  it('rapid re-toggles: only the latest response lands', async () => {
    const first = deferred();
    const second = deferred();
    fetchMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    renderIsland();
    fireEvent.click(sortButton('highest rated'));
    fireEvent.click(sortButton('newest'));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/albums?sort=avg',
      '/api/albums?sort=newest',
    ]);
    const stale: AlbumWithStats[] = [baseAlbum({ id: 'al-30', title: 'Stale Album' })];
    const latest: AlbumWithStats[] = [baseAlbum({ id: 'al-31', title: 'Latest Album' })];
    first.resolve(ok(stale));
    second.resolve(ok(latest));
    await waitFor(() => expect(renderedTitles()).toEqual(['Latest Album']));
    expect(screen.queryByRole('heading', { name: 'Stale Album' })).toBeNull();
  });

  it('sort state is client-side only: interactions never navigate, even from a legacy URL', async () => {
    fetchMock.mockResolvedValue(ok(ALBUMS));
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    renderIsland();
    fireEvent.click(sortButton('highest rated'));
    fireEvent.click(sortButton('newest'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((window.location as unknown as { href: string }).href).toBe('http://localhost:4321/albums?sort=avg');
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('no albums yet → the empty-state message survives; toggling still asks the server', async () => {
    fetchMock.mockResolvedValue(ok([]));
    renderIsland({ albums: [] });
    expect(screen.getByText('nothing here yet.')).toBeTruthy();
    expect(screen.queryByTestId('album-grid')).toBeNull();
    fireEvent.click(sortButton('highest rated'));
    expect(fetchMock).toHaveBeenCalledWith('/api/albums?sort=avg');
    await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(1));
    expect(screen.getByText('nothing here yet.')).toBeTruthy();
  });
});
