// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AdminUsers, type AdminUserRow } from '../../src/components/islands/AdminUsers.tsx';

let fetchMock: ReturnType<typeof vi.fn>;

const row = (overrides: Partial<AdminUserRow> = {}): AdminUserRow => ({
  id: 1,
  username: 'bob',
  displayName: 'Bob',
  isAdmin: false,
  isOriginalAdmin: false,
  isActive: true,
  joinedAt: 1_700_000_000_000,
  submissionCount: 2,
  ratingCount: 3,
  ...overrides,
});

const ok = (user: AdminUserRow): Response =>
  new Response(JSON.stringify({ user }), { status: 200, headers: { 'content-type': 'application/json' } });

const error = (message: string, status = 400): Response =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<AdminUsers> (issues #53, #58, #62 — icon actions with Bootstrap-style tooltips + cursor states)', () => {
  it('drops the queue column; every action is an icon button with a bare-action tip + row-specific aria name', () => {
    render(<AdminUsers users={[row(), row({ id: 2, username: 'carol', isAdmin: true })]} />);
    expect(screen.queryByText('queue')).toBeNull();
    for (const [tip, aria] of [
      ['Promote', 'promote bob'],
      ['Deactivate', 'deactivate bob'],
      ['Reset password', "reset bob's password"],
      ['Demote', 'demote carol'],
      ['Deactivate', 'deactivate carol'],
      ['Reset password', "reset carol's password"],
    ] as const) {
      const button = screen.getByRole('button', { name: aria });
      expect(button.getAttribute('title')).toBe(tip);
      expect(button.getAttribute('aria-label')).toBe(aria);
    }
  });

  it('every icon container is the same h-7 w-7 square; the lock keeps its amber styling', () => {
    render(
      <AdminUsers users={[row(), row({ id: 2, username: 'carol', isAdmin: true, isOriginalAdmin: true })]} />,
    );
    for (const name of ['deactivate bob', "reset bob's password", 'deactivate carol', "reset carol's password"]) {
      expect(screen.getByRole('button', { name }).className).toContain('h-7 w-7');
    }
    const lock = screen.getByTitle('Original admin');
    expect(lock.className).toContain('h-7 w-7');
    expect(lock.className).toContain('border-amber-500/50');
  });

  it('hovering an action opens the portal tip with the bare action word', () => {
    render(<AdminUsers users={[row()]} />);
    const button = screen.getByRole('button', { name: 'deactivate bob' });
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    const tip = screen.getByText('Deactivate');
    expect(tip.className).toContain('opacity-100');
    expect(tip.getAttribute('aria-hidden')).toBe('true');
  });

  it('deactivated members swap deactivate for activate', () => {
    render(<AdminUsers users={[row({ isActive: false })]} />);
    expect(screen.getByRole('button', { name: 'activate bob' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'deactivate bob' })).toBeNull();
  });

  it('the original admin shows the lock icon instead of a demote or promote button', () => {
    render(<AdminUsers users={[row({ isAdmin: true, isOriginalAdmin: true })]} />);
    expect(screen.queryByRole('button', { name: 'demote bob' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'promote bob' })).toBeNull();
    const lock = screen.getByTitle('Original admin');
    expect(lock.getAttribute('title')).toBe('Original admin');
    expect(lock.getAttribute('aria-label')).toBe('the first member ever — permanently admin');
  });

  it('actionable buttons point; the original admin\'s deactivate is disabled with a not-allowed cursor (issue #62)', () => {
    render(<AdminUsers users={[row(), row({ id: 2, username: 'carol', isAdmin: true, isOriginalAdmin: true })]} />);
    for (const name of [
      'promote bob',
      'deactivate bob',
      "reset bob's password",
      'deactivate carol',
      "reset carol's password",
    ] as const) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(button.className).toContain('cursor-pointer');
      if (name === 'deactivate carol') {
        // The permanent admin cannot be deactivated — the button never wakes up.
        expect(button.disabled).toBe(true);
        expect(button.className).toContain('disabled:cursor-not-allowed');
      } else {
        expect(button.disabled).toBe(false);
      }
    }
    fireEvent.click(screen.getByRole('button', { name: 'deactivate carol' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('icon buttons POST the unchanged payloads to /api/admin/users/{id}', async () => {
    fetchMock.mockResolvedValue(ok(row()));
    render(<AdminUsers users={[row(), row({ id: 2, username: 'carol', isAdmin: true })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'promote bob' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/users/1');

    fireEvent.click(screen.getByRole('button', { name: 'demote carol' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/users/2');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ action: 'demote' });

    fireEvent.click(screen.getByRole('button', { name: 'deactivate bob' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({ action: 'deactivate' });
  });

  it('a successful action merges the response user back into the row', async () => {
    fetchMock.mockResolvedValue(ok(row({ isActive: false })));
    render(<AdminUsers users={[row()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'deactivate bob' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'activate bob' })).toBeTruthy());
  });

  it('reset password prompts, then posts the typed password', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('fresh-pass-99'));
    fetchMock.mockResolvedValue(ok(row()));
    render(<AdminUsers users={[row()]} />);
    fireEvent.click(screen.getByRole('button', { name: "reset bob's password" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      action: 'reset_password',
      password: 'fresh-pass-99',
    });
  });

  it('cancelling the reset prompt sends nothing', () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue(null));
    render(<AdminUsers users={[row()]} />);
    fireEvent.click(screen.getByRole('button', { name: "reset bob's password" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('per-row errors render textually in role=alert and the row can retry', async () => {
    fetchMock.mockResolvedValue(error('user is already an admin', 409));
    render(<AdminUsers users={[row(), row({ id: 2, username: 'carol' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'promote bob' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('user is already an admin'));
    expect(
      (screen.getByRole('button', { name: 'promote bob' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('network failure shows the fallback alert', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    render(<AdminUsers users={[row()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'deactivate bob' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('network error — try again'));
  });

  it('the double-press guard keeps exactly one action in flight', async () => {
    let resolveFirst: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (resolveFirst = resolve)),
    );
    render(<AdminUsers users={[row()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'promote bob' }));
    fireEvent.click(screen.getByRole('button', { name: 'deactivate bob' })); // busy → ignored
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFirst(ok(row({ isAdmin: true })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // no second call ever
  });
});
