// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RatingWidget } from '../../src/components/islands/RatingWidget.tsx';

const segments = () => screen.getAllByRole('button', { name: /stars$/ });
const onSegments = () => document.querySelectorAll('.rating-segment--on');

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<RatingWidget>', () => {
  it('renders 10 half-star segments with aria labels', () => {
    render(<RatingWidget albumId="a1" />);
    const all = segments();
    expect(all).toHaveLength(10);
    expect(all[6].getAttribute('aria-label')).toBe('3.5 stars');
    expect(onSegments()).toHaveLength(0); // nothing selected initially
  });

  it('clicking the 7th segment shows 3.5 and PUTs {score: 7}', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<RatingWidget albumId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: '3.5 stars' }));
    expect(onSegments()).toHaveLength(7);
    fireEvent.click(screen.getByText('save rating'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/ratings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ album_id: 'a1', score: 7 });
  });

  it('renders the initial rating as selected', () => {
    render(<RatingWidget albumId="a1" initialScore={8} initialComment="great" />);
    expect(onSegments()).toHaveLength(8);
    expect((screen.getByPlaceholderText('optional comment') as HTMLTextAreaElement).value).toBe('great');
  });

  it('delete → confirm → DELETE; then the widget resets', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<RatingWidget albumId="a1" initialScore={8} initialComment="great" />);
    fireEvent.click(screen.getByText('delete'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/ratings?album_id=a1');
    expect(init.method).toBe('DELETE');
    expect(onSegments()).toHaveLength(0);
  });

  it('API 400 → inline error, selection rolled back', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'score must be between 1 and 10' }), { status: 400 }),
    );
    render(<RatingWidget albumId="a1" initialScore={4} />);
    // '2.5 stars' is the 5th half-star segment; '5 stars' is the 10th.
    fireEvent.click(screen.getByRole('button', { name: '2.5 stars' }));
    expect(onSegments()).toHaveLength(5);
    fireEvent.click(screen.getByText('save rating'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('score must be between 1 and 10');
    expect(onSegments()).toHaveLength(4); // rolled back to the initial 4
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
    await waitFor(() => expect((screen.getByText('save rating') as HTMLButtonElement).disabled).toBe(false));
  });

  it('comment maxlength mirrors the API limit (2000)', () => {
    render(<RatingWidget albumId="a1" />);
    expect((screen.getByPlaceholderText('optional comment') as HTMLTextAreaElement).maxLength).toBe(2000);
  });
});
