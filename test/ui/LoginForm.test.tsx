// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LoginForm } from '../../src/components/islands/LoginForm.tsx';
import { SignupForm } from '../../src/components/islands/SignupForm.tsx';

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

const typeLogin = (username: string, password: string) => {
  const usernameInput = screen.getByLabelText(/username/);
  const passwordInput = screen.getByLabelText(/password/);
  fireEvent.input(usernameInput, { target: { value: username } });
  fireEvent.input(passwordInput, { target: { value: password } });
};

describe('<LoginForm>', () => {
  it('submits the payload and redirects home on success', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 1, username: 'bob' }), { status: 200 }));
    render(<LoginForm />);
    typeLogin('bob', 'bob-password');
    fireEvent.click(screen.getByText('log in'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'bob', password: 'bob-password' });
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/'));
  });

  it('401 → inline error', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid username or password' }), { status: 401 }));
    render(<LoginForm />);
    typeLogin('bob', 'wrong');
    fireEvent.click(screen.getByText('log in'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('invalid username or password'));
  });

  it('429 → rate-limit message', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'too many attempts — try again later' }), { status: 429 }));
    render(<LoginForm />);
    typeLogin('bob', 'wrong');
    fireEvent.click(screen.getByText('log in'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('too many attempts'));
  });
});

describe('<SignupForm>', () => {
  it('submits all four fields and redirects home on success', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 1, username: 'new' }), { status: 201 }));
    render(<SignupForm />);
    fireEvent.input(screen.getByLabelText(/join code/), { target: { value: 'JOINCODE123' } });
    fireEvent.input(screen.getByLabelText(/username/), { target: { value: 'new-member' } });
    fireEvent.input(screen.getByLabelText(/display name/), { target: { value: 'New Member' } });
    fireEvent.input(screen.getByLabelText(/password/), { target: { value: 'new-member-pass' } });
    fireEvent.click(screen.getByText('sign up'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      join_code: 'JOINCODE123',
      username: 'new-member',
      display_name: 'New Member',
      password: 'new-member-pass',
    });
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/'));
  });

  it('shows the join-code hint', () => {
    render(<SignupForm />);
    expect(screen.getByText('ask an admin for the club code')).toBeTruthy();
  });

  it('server error (e.g. bad join code) → inline alert', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid join code' }), { status: 401 }));
    render(<SignupForm />);
    fireEvent.input(screen.getByLabelText(/join code/), { target: { value: 'WRONG' } });
    fireEvent.input(screen.getByLabelText(/username/), { target: { value: 'who' } });
    fireEvent.input(screen.getByLabelText(/display name/), { target: { value: 'Who' } });
    fireEvent.input(screen.getByLabelText(/password/), { target: { value: 'who-pass-123' } });
    fireEvent.click(screen.getByText('sign up'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('invalid join code'));
  });
});
