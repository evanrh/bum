// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ProfileSettings, AVATAR_MAX_BYTES } from '../../src/components/islands/ProfileSettings.tsx';

let fetchMock: ReturnType<typeof vi.fn>;
const reloadSpy = vi.fn();
const assignSpy = vi.fn();

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { assign: (href: string) => assignSpy(href), search: '' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  assignSpy.mockClear();
});

const renderIsland = (avatarVersion: number | null = null) =>
  render(
    <ProfileSettings
      username="bob"
      initialDisplayName="Bob"
      avatarVersion={avatarVersion}
      userId={7}
    />,
  );

// reloadPage is imported by the island as a binding; stub window.location.reload.
const stubReload = (): void => {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload: reloadSpy },
    writable: true,
  });
};

describe('<ProfileSettings>', () => {
  it('saves the display name and reloads the page on success', async () => {
    stubReload();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    renderIsland();
    const input = screen.getByLabelText(/shown next to your ratings/i);
    fireEvent.input(input, { target: { value: 'Bobby Tables' } });
    fireEvent.click(screen.getByText('save name'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/profile/display-name');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ display_name: 'Bobby Tables' });
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
  });

  it('rename error → inline alert', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'display name is required' }), { status: 400 }));
    renderIsland();
    fireEvent.click(screen.getByText('save name'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('display name is required'));
  });

  it('password change redirects to /login (logged out everywhere)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, loggedOut: true }), { status: 200 }));
    renderIsland();
    fireEvent.input(screen.getByLabelText(/current password/i), { target: { value: 'pw-bob' } });
    fireEvent.input(screen.getByLabelText(/new password/i), { target: { value: 'brand-new-pass' } });
    fireEvent.click(screen.getByText('change password'));
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/login'));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      current_password: 'pw-bob',
      new_password: 'brand-new-pass',
    });
  });

  it('current-password error → inline alert with the server message', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'current password is incorrect' }), { status: 400 }));
    renderIsland();
    fireEvent.input(screen.getByLabelText(/current password/i), { target: { value: 'wrong' } });
    fireEvent.input(screen.getByLabelText(/new password/i), { target: { value: 'brand-new-pass' } });
    fireEvent.click(screen.getByText('change password'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('current password is incorrect'));
  });

  it('rejects oversized files client-side without hitting the endpoint', async () => {
    renderIsland();
    const picker = screen.getByLabelText(/choose image…/i);
    const big = new File([new ArrayBuffer(AVATAR_MAX_BYTES + 1)], 'big.png', { type: 'image/png' });
    Object.defineProperty(picker, 'files', { value: [big] });
    fireEvent.change(picker);
    fireEvent.click(screen.getByText('upload picture'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('2 MB max'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads the chosen file as multipart and reloads; version-busts the preview', async () => {
    stubReload();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    renderIsland(42);
    expect(screen.getByTestId('avatar-preview').getAttribute('src')).toBe('/api/avatars/7?v=42');
    const picker = screen.getByLabelText(/choose image…/i);
    const small = new File([new ArrayBuffer(16)], 'me.png', { type: 'image/png' });
    Object.defineProperty(picker, 'files', { value: [small] });
    fireEvent.change(picker);
    fireEvent.click(screen.getByText('upload picture'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/profile/avatar');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
  });
});
