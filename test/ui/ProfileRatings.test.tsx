// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

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

// Distinct recencies and mixed scores: two rows tie on score (5) with the
// later id rated more recently — score sorting must break the tie by id desc.
const ROWS: MyRatingRow[] = [
  baseRow({ id: 11, albumId: 'al-1', albumTitle: 'First Album', albumArtist: 'Artist One', albumYear: null, createdAt: NOW - 2 * DAY, score: 5 }),
  baseRow({ id: 12, albumId: 'al-2', albumTitle: 'Second Album', albumArtist: 'Artist Two', createdAt: NOW - 3 * HOUR, score: 9, comment: 'loved it' }),
  baseRow({ id: 13, albumId: 'al-3', albumTitle: 'Third Album', albumArtist: 'Artist Three', createdAt: NOW - 5 * MINUTE, score: 5 }),
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

/**
 * A legacy query string in the URL exercises the "client state only"
 * contract: rendered content ignores it, and no interaction navigates.
 */
beforeEach(() => {
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

describe('<ProfileRatings> sort toggles (issue #54)', () => {
  it('fresh load renders date created, descending — the legacy query string is ignored', () => {
    renderIsland();
    expect(linkHrefs()).toEqual(['/albums/al-3', '/albums/al-2', '/albums/al-1']);
    expect(fieldButton('date created').getAttribute('aria-current')).toBe('true');
    expect(fieldButton('rating').getAttribute('aria-current')).toBeNull();
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

  it('no ratings yet → the empty-state message survives', () => {
    renderIsland([]);
    expect(screen.getByText('no ratings yet — open an album and give it a score.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
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

  it('clicking the active field flips direction and the chevron follows (asc = up)', () => {
    renderIsland();
    fireEvent.click(fieldButton('date created'));
    expect(linkHrefs()).toEqual(['/albums/al-1', '/albums/al-2', '/albums/al-3']);
    expect(fieldButton('date created').getAttribute('aria-current')).toBe('true');
    expect(screen.queryByTestId('chevron-desc')).toBeNull();
    expect(screen.getByTestId('chevron-asc').closest('button')).toBe(fieldButton('date created'));
  });

  it('clicking an inactive field activates it at its default: rating → highest first', () => {
    renderIsland();
    fireEvent.click(fieldButton('rating'));
    expect(linkHrefs()).toEqual(['/albums/al-2', '/albums/al-3', '/albums/al-1']); // tie 5s break by id desc
    const rating = fieldButton('rating');
    const date = fieldButton('date created');
    expect(rating.getAttribute('aria-current')).toBe('true');
    expect(date.getAttribute('aria-current')).toBeNull();
    expect(rating.className).toContain('bg-zinc-100');
    expect(date.className).not.toContain('bg-zinc-100');
    // The chevron moved with the activity: rating desc, date shows none.
    expect(screen.getByTestId('chevron-desc').closest('button')).toBe(rating);
    expect(rating.contains(screen.getByTestId('chevron-desc'))).toBe(true);
  });

  it('rating, then rating again: active flip lands at lowest first', () => {
    renderIsland();
    fireEvent.click(fieldButton('rating')); // activate at default desc
    fireEvent.click(fieldButton('rating')); // flip to asc
    expect(linkHrefs()).toEqual(['/albums/al-3', '/albums/al-1', '/albums/al-2']); // tie 5s still break by id desc
    expect(screen.queryByTestId('chevron-desc')).toBeNull();
    expect(screen.getByTestId('chevron-asc').closest('button')).toBe(fieldButton('rating'));
  });

  it('flipping date back down restores newest first', () => {
    renderIsland();
    fireEvent.click(fieldButton('date created')); // asc
    fireEvent.click(fieldButton('date created')); // back to desc
    expect(linkHrefs()).toEqual(['/albums/al-3', '/albums/al-2', '/albums/al-1']);
    expect(screen.queryByTestId('chevron-asc')).toBeNull();
    expect(screen.getByTestId('chevron-desc').closest('button')).toBe(fieldButton('date created'));
  });

  it('sort state is client-side only: interactions never mutate the URL', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    renderIsland();
    fireEvent.click(fieldButton('rating'));
    fireEvent.click(fieldButton('rating'));
    fireEvent.click(fieldButton('date created'));
    expect((window.location as unknown as { href: string }).href).toBe(
      'http://localhost:4321/profile?sort=score&dir=asc',
    );
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
