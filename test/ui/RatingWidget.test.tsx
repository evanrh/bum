// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RatingWidget } from '../../src/components/islands/RatingWidget.tsx';

// jsdom's `location.reload` is non-configurable (cannot be stubbed), so the
// widget goes through src/lib/reload.ts — mock that module here.
const reloadMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/reload.ts', () => ({ reloadPage: reloadMock }));

// 5-star scale: 10 clickable half-star targets, labelled in star units.
const halfButtons = () => screen.queryAllByRole('button', { name: / stars$/ });
const baseRow = () => document.querySelector('.rating-stars') as HTMLElement;
const fillLayer = () => document.querySelector('.star-display-fill') as HTMLElement;
const fillPct = () => fillLayer().style.width;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
  reloadMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<RatingWidget>', () => {
  it('renders the 5-star scale as 5 glyphs with 10 half-star targets', () => {
    render(<RatingWidget albumId="a1" />);
    const all = halfButtons();
    expect(all).toHaveLength(10);
    expect(all[0].getAttribute('aria-label')).toBe('0.5 stars'); // first half-step
    expect(all[6].getAttribute('aria-label')).toBe('3.5 stars'); // one step per half-star
    expect(all[9].getAttribute('aria-label')).toBe('5 stars');   // max of the 5-star scale
    expect(baseRow().textContent).toBe('★★★★★');                  // 5 glyphs, not 10
    expect(fillPct()).toBe('0%');                                // nothing selected initially
  });

  it('clicking the 3.5★ target fills to 70% and PUTs {score: 7}', () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<RatingWidget albumId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: '3.5 stars' }));
    expect(fillPct()).toBe('70%');
    fireEvent.click(screen.getByText('save rating'));
    return waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1)).then(() => {
      const [path, init] = fetchMock.mock.calls[0];
      expect(path).toBe('/api/ratings');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body as string)).toEqual({ album_id: 'a1', score: 7 });
    });
  });

  it('renders an existing rating read-only — grayed, no editor, explicit edit button', () => {
    render(<RatingWidget albumId="a1" initialScore={7} initialComment="great" />);
    expect(document.querySelector('.rating-readonly')).toBeTruthy(); // grayed-out wrapper
    expect(fillPct()).toBe('70%');
    expect(screen.getByText('3.5★')).toBeTruthy();                    // score in star units
    expect(screen.getByText('great')).toBeTruthy();                   // comment as text
    expect(screen.queryByPlaceholderText('optional comment')).toBeNull();
    expect(halfButtons()).toHaveLength(0);                            // not editable yet
    expect(screen.getByText('edit rating')).toBeTruthy();
    expect(screen.getByText('delete')).toBeTruthy();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('edit button enables editing; changes save and reload', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<RatingWidget albumId="a1" initialScore={7} initialComment="great" />);
    fireEvent.click(screen.getByText('edit rating'));
    expect(halfButtons()).toHaveLength(10);
    expect((screen.getByPlaceholderText('optional comment') as HTMLTextAreaElement).value).toBe('great');
    expect(fillPct()).toBe('70%');
    fireEvent.click(screen.getByRole('button', { name: '2.5 stars' }));
    expect(fillPct()).toBe('50%');
    fireEvent.click(screen.getByText('save rating'));
    await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ album_id: 'a1', score: 5, comment: 'great' });
  });

  it('cancel leaves edit mode and restores the saved rating', () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<RatingWidget albumId="a1" initialScore={4} initialComment="meh" />);
    fireEvent.click(screen.getByText('edit rating'));
    fireEvent.click(screen.getByRole('button', { name: '5 stars' }));
    expect(fillPct()).toBe('100%');
    fireEvent.click(screen.getByText('cancel'));
    expect(fillPct()).toBe('40%');
    expect(screen.getByText('2★')).toBeTruthy();
    expect(screen.getByText('meh')).toBeTruthy();
    expect(halfButtons()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delete → confirm → DELETE; then the page reloads', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<RatingWidget albumId="a1" initialScore={8} />);
    fireEvent.click(screen.getByText('delete'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/ratings?album_id=a1');
    expect(init.method).toBe('DELETE');
    await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));
  });

  it('API 400 → inline error, selection kept for retry, no reload', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'score must be between 1 and 10' }), { status: 400 }),
    );
    render(<RatingWidget albumId="a1" initialScore={4} />);
    // '2.5 stars' is the 5th half-star target; '5 stars' is the 10th.
    fireEvent.click(screen.getByText('edit rating'));
    fireEvent.click(screen.getByRole('button', { name: '2.5 stars' }));
    expect(fillPct()).toBe('50%');
    fireEvent.click(screen.getByText('save rating'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('score must be between 1 and 10');
    // The un-saved selection stays in place so the user can adjust and retry;
    // the page (and its saved state) has not been reloaded.
    expect(fillPct()).toBe('50%');
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('API /network failures keep the editor open so the user can retry', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    render(<RatingWidget albumId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: '4 stars' }));
    fireEvent.click(screen.getByText('save rating'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('network error');
    expect(screen.getByText('save rating')).toBeTruthy(); // still in edit mode to retry
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('double-press guard: save is disabled while pending', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((resolve) => (resolveFetch = resolve)));
    render(<RatingWidget albumId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: '4 stars' }));
    fireEvent.click(screen.getByText('save rating'));
    expect((screen.getByText('saving…') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('saving…')); // second press while pending
    expect(fetchMock).toHaveBeenCalledTimes(1); // guarded
    resolveFetch(new Response(JSON.stringify({}), { status: 200 }));
    await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));
  });

  it('comment maxlength mirrors the API limit (2000)', () => {
    render(<RatingWidget albumId="a1" />);
    expect((screen.getByPlaceholderText('optional comment') as HTMLTextAreaElement).maxLength).toBe(2000);
  });
});
