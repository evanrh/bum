// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SubmitForm } from '../../src/components/islands/SubmitForm.tsx';

let fetchMock: ReturnType<typeof vi.fn>;
const assignSpy = vi.fn();

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { assign: vi.fn((href: string) => assignSpy(href)), search: '' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  assignSpy.mockClear();
});

const submit = () => fireEvent.click(screen.getByText('submit the album'));

describe('<SubmitForm>', () => {
  it('renders the week banner line', () => {
    render(<SubmitForm weekStart="2026-01-05" />);
    expect(screen.getByText(/submitting for the week of 2026-01-05/)).toBeTruthy();
  });

  it('validates live per field and clears on fix', () => {
    render(<SubmitForm weekStart="2026-01-05" />);
    const title = screen.getAllByRole('textbox')[0];
    fireEvent.input(title, { target: { value: 'x'.repeat(201) } }); // too long
    expect(screen.getByText('title must be at most 200 characters')).toBeTruthy();
    fireEvent.input(title, { target: { value: 'Kind of Blue' } });
    expect(screen.queryByText(/title must be/)).toBeNull();
  });

  it('empty required fields → jsdom constraint validation blocks submit (no fetch call)', () => {
    render(<SubmitForm weekStart="2026-01-05" />);
    submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('valid input → POST with the payload; success assigns to the new album page', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'album-uuid', title: 'Kind of Blue' }), { status: 201 }),
    );
    render(<SubmitForm weekStart="2026-01-05" />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.input(inputs[0], { target: { value: 'Kind of Blue' } });
    fireEvent.input(inputs[1], { target: { value: 'Miles Davis' } });
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/albums');
    expect(init.method).toBe('POST');
    const payload = JSON.parse(init.body as string);
    expect(payload).toMatchObject({ title: 'Kind of Blue', artist: 'Miles Davis' });
    expect('year' in payload).toBe(false); // omitted optional year is dropped
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/albums/album-uuid'));
  });

  it('409 → friendly duplicate message', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'an album was already submitted this week' }), { status: 409 }));
    render(<SubmitForm weekStart="2026-01-05" />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.input(inputs[0], { target: { value: 'Kind of Blue' } });
    fireEvent.input(inputs[1], { target: { value: 'Miles Davis' } });
    submit();
    await waitFor(() => expect(screen.getByText('already submitted this week')).toBeTruthy());
  });

  it("403 → the server's named-picker message", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "it's not your week — Bob picks this week" }), { status: 403 }),
    );
    render(<SubmitForm weekStart="2026-01-05" />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.input(inputs[0], { target: { value: 'Kind of Blue' } });
    fireEvent.input(inputs[1], { target: { value: 'Miles Davis' } });
    submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("it's not your week"));
  });

  it('out-of-range year → live field error; blocked submit, no fetch call', async () => {
    render(<SubmitForm weekStart="2026-01-05" />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.input(inputs[0], { target: { value: 'Kind of Blue' } });
    fireEvent.input(inputs[1], { target: { value: 'Miles Davis' } });
    // type=number inputs sanitize non-numeric typing in the DOM — the
    // reachable schema failure is out-of-range, not non-numeric.
    const year = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.input(year, { target: { value: '1899' } });
    expect(screen.getByText('year must be between 1900 and 2100')).toBeTruthy();
    submit();
    await waitFor(() => expect(screen.getByText('year must be between 1900 and 2100')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
