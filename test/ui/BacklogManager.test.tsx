// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BacklogManager } from '../../src/components/islands/BacklogManager.tsx';

const ITEMS = [
  { id: 'a', title: 'Alpha', artist: 'One', year: null, spotifyId: null, youtubeId: null, coverUrl: null, note: null },
  { id: 'b', title: 'Beta', artist: 'Two', year: null, spotifyId: null, youtubeId: null, coverUrl: null, note: null },
  { id: 'c', title: 'Gamma', artist: 'Three', year: null, spotifyId: null, youtubeId: null, coverUrl: null, note: null },
];

let fetchMock: ReturnType<typeof vi.fn>;

const stubEvent = (): { dataTransfer: { setData: ReturnType<typeof vi.fn>; effectAllowed: string } } => ({
  dataTransfer: { setData: vi.fn(), effectAllowed: '' },
});

const saveButton = () => screen.queryByText('save order');
const queueText = () => document.querySelector('ol')?.textContent ?? '';

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<BacklogManager> drag-to-reorder (issue #25)', () => {
  it('ships with no save button while the queue is untouched', () => {
    render(<BacklogManager items={ITEMS} autoBacklog />);
    expect(saveButton()).toBeNull();
    expect(queueText()).toContain('Alpha');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders queue entries as album-style cards with covers, notes and no embeds', () => {
    render(
      <BacklogManager
        items={[
          { ...ITEMS[0], coverUrl: '/cover-alpha.jpg', note: 'a keeper' },
          { ...ITEMS[1], spotifyId: 'abc1234567', youtubeId: 'abcdefghijk', year: 1999 },
        ]}
        autoBacklog
      />,
    );
    expect(document.querySelector('ol')?.className).toContain('grid-cols-2');
    expect(screen.getByAltText('cover of Alpha')).toBeTruthy();
    expect(screen.getByText('“a keeper”')).toBeTruthy();
    expect(screen.getByText('Two (1999)')).toBeTruthy();
    expect(document.querySelectorAll('.album-card-fallback')).toHaveLength(1);
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getAllByText('next up')).toHaveLength(1);
  });

  it('dragging is local: the save button appears and persists the full order', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<BacklogManager items={ITEMS} autoBacklog />);
    const first = screen.getByText('Alpha');
    const third = screen.getByText('Gamma');
    fireEvent.dragStart(first, stubEvent());
    fireEvent.dragOver(third, stubEvent());
    // Live swap, nothing posted yet.
    expect(queueText()).toContain('Gamma');
    expect(saveButton()).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('save order'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/backlog/order');
    expect(JSON.parse(init.body as string)).toEqual({ ids: ['c', 'b', 'a'] });
    await waitFor(() => expect(saveButton()).toBeNull());
  });

  it('removing an item commits immediately and does not leave the save button behind', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<BacklogManager items={ITEMS} autoBacklog />);
    fireEvent.click(screen.getAllByText('remove')[1]); // remove Beta
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/backlog/b');
    expect(init.method).toBe('DELETE');
    await waitFor(() => expect(queueText()).not.toContain('Beta'));
    await waitFor(() => expect(saveButton()).toBeNull()); // removal reset the confirmed state
  });

  it('adding an item commits behind the confirmed order and clears any unsaved drag', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'new', title: 'Delta', artist: 'Four', year: null, spotifyId: null, youtubeId: null, coverUrl: null, note: null }), { status: 201 }),
    );
    render(<BacklogManager items={ITEMS} autoBacklog />);
    // Local (unsaved) reorder first: Beta to the front.
    const first = screen.getByText('Alpha');
    const second = screen.getByText('Beta');
    fireEvent.dragStart(second, stubEvent());
    fireEvent.dragOver(first, stubEvent());
    expect(saveButton()).toBeTruthy(); // dirty, not saved

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Delta' } });
    fireEvent.input(screen.getByLabelText(/title/i), { target: { value: 'Delta' } });
    fireEvent.change(screen.getByLabelText(/^artist/i), { target: { value: 'Four' } });
    fireEvent.input(screen.getByLabelText(/^artist/i), { target: { value: 'Four' } });
    fireEvent.click(screen.getByText('add to backlog'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/backlog');
    // The commit lands behind the CONFIRMED order [a,b] + [new]; the local drag is dropped.
    await waitFor(() => expect(queueText()).toContain('Delta'));
    await waitFor(() => expect(saveButton()).toBeNull()); // everything committed again
  });

  it('a failed save keeps the queue and the button for a one-click retry', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    render(<BacklogManager items={ITEMS} autoBacklog />);
    const first = screen.getByText('Alpha');
    fireEvent.dragStart(first, stubEvent());
    fireEvent.dragOver(screen.getByText('Beta'), stubEvent());
    fireEvent.click(screen.getByText('save order'));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect((screen.getByText('save order') as HTMLButtonElement).disabled).toBe(false);
    expect(queueText()).toContain('Gamma'); // attempted order survives
    expect(saveButton()).toBeTruthy();

    fireEvent.click(screen.getByText('save order'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(saveButton()).toBeNull());
  });

  it('keyboard moves still work and are local until saved', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<BacklogManager items={ITEMS} autoBacklog />);
    fireEvent.click(screen.getByLabelText('move Gamma up'));
    expect(queueText()).toContain('Gamma');
    expect(screen.getByText('save order')).toBeTruthy();
    fireEvent.click(screen.getByText('save order'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0][1]?.body ?? '') as string)).toEqual({ ids: ['a', 'c', 'b'] });
    await waitFor(() => expect(saveButton()).toBeNull());
  });
});
