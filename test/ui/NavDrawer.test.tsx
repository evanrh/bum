// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { NavDrawer, type NavUser } from '../../src/components/islands/NavDrawer.tsx';

const member: NavUser = { id: 7, displayName: 'Bob', isAdmin: false };

type RenderOpts = {
  user?: NavUser | null;
  avatarContentType?: string | null;
  canSubmit?: boolean;
};

const renderIsland = ({
  user = member,
  avatarContentType = null,
  canSubmit = false,
}: RenderOpts = {}) =>
  render(<NavDrawer user={user} avatarContentType={avatarContentType} canSubmit={canSubmit} />);

const hamburger = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'open menu' }) as HTMLButtonElement;

// jsdom doesn't implement window.matchMedia — the island uses it only to
// dismiss the drawer if the viewport crosses to desktop while open.
const mediaQuery = (): MediaQueryList & { fire: (matches: boolean) => void } => {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  return {
    matches: false,
    media: '(min-width: 768px)',
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void): void => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void): void => {
      listeners.delete(listener);
    },
    fire: (matches: boolean): void => {
      for (const listener of [...listeners]) listener({ matches } as MediaQueryListEvent);
    },
  } as MediaQueryList & { fire: (matches: boolean) => void };
};

let mql: ReturnType<typeof mediaQuery>;

beforeEach(() => {
  document.body.style.overflow = '';
  mql = mediaQuery();
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<NavDrawer>', () => {
  it('renders the hamburger with its a11y state and keeps the drawer closed', () => {
    renderIsland();
    const button = hamburger();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('nav-drawer');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on click: expanded state, scroll lock, focus moves into the drawer', () => {
    renderIsland();
    fireEvent.click(hamburger());
    const panel = screen.getByRole('dialog', { name: 'menu' });
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(hamburger().getAttribute('aria-expanded')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(panel);
  });

  it('closes on Esc — dialog gone, scroll unlocked, focus back on the hamburger', () => {
    renderIsland();
    fireEvent.click(hamburger());
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(hamburger());
  });

  it('closes on overlay click and on link activation, restoring scroll', () => {
    renderIsland();
    fireEvent.click(hamburger());
    fireEvent.click(screen.getByTestId('drawer-overlay'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');

    fireEvent.click(hamburger());
    fireEvent.click(screen.getByRole('link', { name: 'dashboard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(hamburger());
  });

  it('dismisses when the viewport crosses to desktop while open', () => {
    renderIsland();
    fireEvent.click(hamburger());
    expect(screen.queryByRole('dialog')).not.toBeNull();
    act(() => mql.fire(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('signed-in members get the full page list with today\'s visibility', () => {
    renderIsland({ user: member });
    fireEvent.click(hamburger());
    for (const [name, href] of [
      ['dashboard', '/'],
      ['albums', '/albums'],
      ['profile', '/profile'],
      ['backlog', '/backlog'],
    ] as const) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
    }
    expect(screen.queryByRole('link', { name: 'submit your pick' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'admin' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'log in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'sign up' })).toBeNull();
  });

  it('the profile card is the drawer\'s first item (initial fallback + name)', () => {
    const { container } = renderIsland({ user: member, avatarContentType: null });
    fireEvent.click(hamburger());
    expect(container.querySelector('img')).toBeNull();
    const card = screen.getByRole('link', { name: 'Bob' });
    expect(card.getAttribute('href')).toBe('/profile');
    expect(card.textContent).toContain('Bob');
    // Initial fallback, mirroring Avatar.astro.
    const fallback = container.querySelector('span[aria-hidden="true"]');
    expect(fallback?.textContent).toBe('B');
    const dashboard = screen.getByRole('link', { name: 'dashboard' });
    expect(card.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the profile card shows the avatar image when a picture exists', () => {
    const { container } = renderIsland({ user: member, avatarContentType: 'image/png' });
    fireEvent.click(hamburger());
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/avatars/7');
    expect(img?.getAttribute('alt')).toBe("Bob's picture");
  });

  it('amber submit-your-pick appears only when eligible, admin only for admins', () => {
    const { unmount } = renderIsland({ user: member, canSubmit: true });
    fireEvent.click(hamburger());
    const submit = screen.getByRole('link', { name: 'submit your pick' });
    expect(submit.getAttribute('href')).toBe('/submit');
    expect(submit.className).toContain('text-amber-400');
    expect(submit.className).toContain('font-medium');
    unmount();
    cleanup();

    const admin = renderIsland({ user: { ...member, isAdmin: true } });
    fireEvent.click(hamburger());
    expect(screen.getByRole('link', { name: 'admin' }).getAttribute('href')).toBe('/admin');
    admin.unmount();
    cleanup();

    renderIsland({ user: { ...member, isAdmin: false } });
    fireEvent.click(hamburger());
    expect(screen.queryByRole('link', { name: 'admin' })).toBeNull();
  });

  it('log out posts natively to /api/logout', () => {
    const { container } = renderIsland({ user: member });
    fireEvent.click(hamburger());
    const form = container.querySelector('form[action="/api/logout"]');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.querySelector('button')?.textContent).toBe('log out');
  });

  it('guests see log in / sign up in place of the profile card, no member items', () => {
    renderIsland({ user: null, canSubmit: true });
    fireEvent.click(hamburger());
    expect(screen.getByRole('link', { name: 'log in' }).getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: 'sign up' }).getAttribute('href')).toBe('/signup');
    expect(screen.queryByRole('link', { name: 'profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'backlog' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'submit your pick' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'admin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'log out' })).toBeNull();
  });
});
