// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ProfileRatings } from '../../src/components/islands/ProfileRatings.tsx';
import type { MyRatingRow } from '../../src/db/repos/ratings.ts';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const baseRow = (
  overrides: Partial<MyRatingRow> & Pick<MyRatingRow, 'id' | 'albumId' | 'albumTitle' | 'createdAt' | 'score'>,
): MyRatingRow => ({
  userId: 7,
  albumArtist: 'some artist',
  albumYear: 1969,
  comment: null,
  updatedAt: overrides.createdAt,
  ...overrides,
});

// In the server's default order (first-rated, newest first; ties by id desc):
// two rows tie on score (5) with the later id rated more recently — the
// server-side score sort breaks the tie by id desc (the island merely renders
// responses).
const ROWS: MyRatingRow[] = [
  baseRow({ id: 13, albumId: 'al-3', albumTitle: 'Third Album', albumArtist: 'Artist Three', createdAt: NOW - 5 * MINUTE, score: 5 }),
  baseRow({ id: 12, albumId: 'al-2', albumTitle: 'Second Album', albumArtist: 'Artist Two', createdAt: NOW - 3 * HOUR, score: 9, comment: 'loved it' }),
  baseRow({ id: 11, albumId: 'al-1', albumTitle: 'First Album', albumArtist: 'Artist One', albumYear: null, createdAt: NOW - 2 * DAY, score: 5 }),
];

const renderIsland = (rows: MyRatingRow[] = ROWS) => render(<ProfileRatings rows={rows} now={NOW} />);

const linkHrefs = (): Array<string | null> =>
  screen.getAllByRole('link').map((link) => link.getAttribute('href'));

const fieldButton = (label: 'date created' | 'rating'): HTMLButtonElement =>
  screen.getByRole('button', { name: label }) as HTMLButtonElement;

const rowOf = (title: string): HTMLElement => {
  const row = screen.getByRole('link', { name: title }).closest('li');
  if (row === null) throw new Error(`row for ${title} vanished`);
  return row;
};

const ok = (rows: MyRatingRow[]): Response =>
  new Response(JSON.stringify({ rows }), { status: 200, headers: { 'content-type': 'application/json' } });

const deferred = (): { promise: Promise<Response>; resolve: (response: Response) => void } => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * A legacy query string in the URL exercises the "client state only"
 * contract: rendered content ignores it, and no interaction navigates.
 */
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', {
    href: 'http://localhost:4321/profile?sort=score&dir=asc',
    search: '?sort=score&dir=asc',
    assign: vi.fn(),
    replace: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<ProfileRatings> sort toggles re-fetch from the server (issue #56)', () => {
  it('fresh load renders the SSR rows as-is and fetches nothing on mount', () => {
    renderIsland();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(linkHrefs()).toEqual(['/albums/al-3', '/albums/al-2', '/albums/al-1']);
    expect(fieldButton('date created').getAttribute('aria-current')).toBe('true');
    expect(fieldButton('rating').getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('chevron-desc').closest('button')).toBe(fieldButton('date created'));
  });

  it('rows render in full parity: star score, artist + optional year, comment, relative time', () => {
    renderIsland();
    const second = rowOf('Second Album');
    expect(within(second).getByText('4.5★')).toBeTruthy();
    expect(within(second).getByRole('img', { name: '4.5 stars' })).toBeTruthy();
    expect(within(second).getByText('Artist Two (1969)')).toBeTruthy();
    expect(within(second).getByText('“loved it”')).toBeTruthy();
    expect(within(second).getByText('rated 3h ago')).toBeTruthy();

    // The year is omitted when the album has none.
    const first = rowOf('First Album');
    expect(within(first).getByText('2.5★')).toBeTruthy();
    expect(within(first).getByText('Artist One')).toBeTruthy();
    expect(within(rowOf('Third Album')).getByText('rated 5 min ago')).toBeTruthy();
  });

  it('no ratings yet → the empty-state message survives; toggling still asks the server', async () => {
    fetchMock.mockResolvedValue(ok([]));
    renderIsland([]);
    expect(screen.getByText('no ratings yet — open an album and give it a score.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(fieldButton('rating'));
    expect(fetchMock).toHaveBeenCalledWith('/api/ratings?sort=score&dir=desc');
    await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(1));
    expect(screen.getByText('no ratings yet — open an album and give it a score.')).toBeTruthy();
  });

  it('only the active field is highlighted, aria-marked, and carries a descending chevron', () => {
    renderIsland();
    const date = fieldButton('date created');
    const rating = fieldButton('rating');
    expect(date.className).toContain('bg-zinc-100');
    expect(rating.className).not.toContain('bg-zinc-100');
    expect(screen.queryByTestId('chevron-asc')).toBeNull();
    expect(screen.getByTestId('chevron-desc').closest('button')).toBe(date);
    expect(screen.getByTestId('chevron-desc').closest('button')).not.toBe(rating);
  });

  it('clicking the active field flips direction: the chevron follows at once and the GET carries the flip', () => {
    fetchMock.mockResolvedValue(ok(ROWS));
    renderIsland();
    fireEvent.click(fieldButton('date created'));
    expect(fetchMock).toHaveBeenCalledWith('/api/ratings?sort=created&dir=asc');
    expect(fieldButton('date created').getAttribute('aria-current')).toBe('true');
    expect(screen.queryByTestId('chevron-desc')).toBeNull();
    expect(screen.getByTestId('chevron-asc').closest('button')).toBe(fieldButton('date created'));
  });

  it('clicking an inactive field activates it at its default: rating → highest first', () => {
    fetchMock.mockResolvedValue(ok(ROWS));
    renderIsland();
    fireEvent.click(fieldButton('rating'));
    expect(fetchMock).toHaveBeenCalledWith('/api/ratings?sort=score&dir=desc');
    const rating = fieldButton('rating');
    const date = fieldButton('date created');
    expect(rating.getAttribute('aria-current')).toBe('true');
    expect(date.getAttribute('aria-current')).toBeNull();
    expect(rating.className).toContain('bg-zinc-100');
    expect(date.className).not.toContain('bg-zinc-100');
    expect(screen.getByTestId('chevron-desc').closest('button')).toBe(rating);
  });

  it('the island renders the server response as-is — no client-side re-sorting remains', async () => {
    // Deliberately "wrong" for any client-side ordering rule, with a row the
    // shell never shipped — only the response may decide what renders.
    const serverOrder: MyRatingRow[] = [
      baseRow({ id: 21, albumId: 'al-9', albumTitle: 'Server First', createdAt: NOW, score: 1 }),
      baseRow({ id: 22, albumId: 'al-2', albumTitle: 'Second Album', createdAt: NOW - 3 * HOUR, score: 9 }),
      baseRow({ id: 23, albumId: 'al-1', albumTitle: 'First Album', createdAt: NOW - 2 * DAY, score: 5 }),
    ];
    fetchMock.mockResolvedValue(ok(serverOrder));
    renderIsland();
    fireEvent.click(fieldButton('rating'));
    await waitFor(() => expect(linkHrefs()).toEqual(['/albums/al-9', '/albums/al-2', '/albums/al-1']));
    expect(screen.queryByRole('link', { name: 'Third Album' })).toBeNull();
  });

  it('in flight: the previous list stays visible and dims until the fetch lands', async () => {
    const pending = deferred();
    fetchMock.mockImplementationOnce(() => pending.promise).mockResolvedValue(ok(ROWS));
    renderIsland();
    fireEvent.click(fieldButton('date created'));
    const list = screen.getByTestId('ratings-list');
    expect(list.getAttribute('data-in-flight')).toBe('true');
    expect(list.className).toContain('opacity-60');
    expect(linkHrefs()).toEqual(['/albums/al-3', '/albums/al-2', '/albums/al-1']);
    pending.resolve(ok(ROWS));
    await waitFor(() => expect(screen.getByTestId('ratings-list').getAttribute('data-in-flight')).toBeNull());
  });

  it('a failed re-fetch keeps the previous rows and reports the error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    renderIsland();
    fireEvent.click(fieldButton('rating'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('re-sort failed — try again'));
    expect(linkHrefs()).toEqual(['/albums/al-3', '/albums/al-2', '/albums/al-1']);
    expect(screen.getByTestId('ratings-list').getAttribute('data-in-flight')).toBeNull();
  });

  it('rapid re-toggles: only the latest response lands', async () => {
    const first = deferred();
    const second = deferred();
    fetchMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    renderIsland();
    fireEvent.click(fieldButton('date created'));
    fireEvent.click(fieldButton('rating'));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/ratings?sort=created&dir=asc',
      '/api/ratings?sort=score&dir=desc',
    ]);
    const stale: MyRatingRow[] = [
      baseRow({ id: 31, albumId: 'al-31', albumTitle: 'Stale Album', createdAt: NOW, score: 1 }),
    ];
    const latest: MyRatingRow[] = [
      baseRow({ id: 32, albumId: 'al-32', albumTitle: 'Latest Album', createdAt: NOW, score: 2 }),
    ];
    first.resolve(ok(stale));
    second.resolve(ok(latest));
    await waitFor(() => expect(linkHrefs()).toEqual(['/albums/al-32']));
    expect(screen.queryByRole('link', { name: 'Stale Album' })).toBeNull();
  });

  it('sort state is client-side only: interactions never mutate the URL', async () => {
    fetchMock.mockResolvedValue(ok(ROWS));
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    renderIsland();
    fireEvent.click(fieldButton('rating'));
    fireEvent.click(fieldButton('rating'));
    fireEvent.click(fieldButton('date created'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect((window.location as unknown as { href: string }).href).toBe(
      'http://localhost:4321/profile?sort=score&dir=asc',
    );
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
