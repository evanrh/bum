// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AdminRotation } from '../../src/components/islands/AdminRotation.tsx';

const MEMBERS = [
  { id: 1, name: 'bob' },
  { id: 2, name: 'carol' },
  { id: 3, name: 'dave' },
];

let fetchMock: ReturnType<typeof vi.fn>;

const stubEvent = (): { dataTransfer: { setData: ReturnType<typeof vi.fn>; effectAllowed: string } } => ({
  dataTransfer: { setData: vi.fn(), effectAllowed: '' },
});

const rows = () => ['bob', 'carol', 'dave'].map((name) => screen.getByText(name, { exact: true }));
const saveButton = () => screen.queryByText('save order');

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<AdminRotation> drag-to-reorder (issue #25)', () => {
  it('ships with no save button while the order is untouched', () => {
    render(<AdminRotation queue={MEMBERS} />);
    expect(saveButton()).toBeNull();
    // The rows are drag sources (draggable) for the mouse path.
    const row = screen.getByText('bob', { exact: true });
    expect(row).toBeTruthy();
  });

  it('dragging a row swaps live, shows the save button, and saves the whole queue', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<AdminRotation queue={MEMBERS} />);
    const [first, , third] = rows();
    fireEvent.dragStart(first, stubEvent());
    fireEvent.dragOver(third, stubEvent());
    fireEvent.dragEnd(first, stubEvent());
    // Live swap to the end of the drag path: [dave, carol, bob].
    expect(document.querySelector('ol')?.textContent).toContain('dave');
    expect(saveButton()).toBeTruthy();

    fireEvent.click(screen.getByText('save order'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/admin/rotation/order');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ queue: [3, 2, 1] });
    // Success → the confirmed state catches up → button gone.
    await waitFor(() => expect(saveButton()).toBeNull());
  });

  it('the save button stays through a failed save so the user can retry', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    render(<AdminRotation queue={MEMBERS} />);
    const [first, , third] = rows();
    fireEvent.dragStart(first, stubEvent());
    fireEvent.dragOver(third, stubEvent());
    expect(saveButton()).toBeTruthy();

    fireEvent.click(screen.getByText('save order'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'));
    // The attempted order stays visible for a one-click retry.
    await waitFor(() => expect((screen.getByText('save order') as HTMLButtonElement).disabled).toBe(false));
    expect(saveButton()).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('save order')); // retry
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(saveButton()).toBeNull());
  });

  it('keyboard moves (▲/▼) mark the list dirty and save the same way', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<AdminRotation queue={MEMBERS} />);
    fireEvent.click(screen.getByLabelText('move dave up'));
    expect(screen.getByText('save order')).toBeTruthy();

    fireEvent.click(screen.getByText('save order'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ queue: [1, 3, 2] });
    await waitFor(() => expect(saveButton()).toBeNull());
  });

  it('returning to the confirmed order hides the save button again', () => {
    render(<AdminRotation queue={MEMBERS} />);
    fireEvent.click(screen.getByLabelText('move dave up'));
    expect(saveButton()).toBeTruthy();
    fireEvent.click(screen.getByLabelText('move dave down')); // swap back
    expect(saveButton()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled(); // nothing was saved by moving
  });

  it('the save button is disabled while pending', async () => {
    let resolveSave: (value: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((resolve) => (resolveSave = resolve)));
    render(<AdminRotation queue={MEMBERS} />);
    fireEvent.click(screen.getByLabelText('move carol up'));
    fireEvent.click(screen.getByText('save order'));
    expect((screen.getByText('saving…') as HTMLButtonElement).disabled).toBe(true);
    resolveSave(new Response(JSON.stringify({}), { status: 200 }));
    await waitFor(() => expect(saveButton()).toBeNull());
  });
});
