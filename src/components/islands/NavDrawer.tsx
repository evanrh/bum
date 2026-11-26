import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Match } from '../react/Match.tsx';
import { Show } from '../react/Show.tsx';
import { Switch } from '../react/Switch.tsx';

/**
 * Mobile navigation (issue #52): hamburger + left drawer, the only mobile
 * surface in the header — the desktop nav and header block stay as-is at
 * ≥ md. The layout hands over a serializable nav model: safe user fields
 * only (the session row carries the password hash and never reaches the
 * client), avatar presence per `avatarsRepo.getAvatarMeta`, and submit
 * eligibility. Logout stays a native POST to /api/logout so the browser
 * follows the endpoint's no-JS redirect.
 */

/** Serializable nav model — never the raw user row. */
export type NavUser = {
  id: number;
  displayName: string;
  isAdmin: boolean;
};

export type NavDrawerProps = {
  /** Signed-in member; null renders the guest variant (log in / sign up). */
  user: NavUser | null;
  /** Non-null ⇒ an avatar row exists (same treatment as Avatar.astro). */
  avatarContentType: string | null;
  canSubmit: boolean;
};

const PANEL_ID = 'nav-drawer';

const item = 'rounded px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white';
const amberItem = 'rounded px-2 py-2 text-sm font-medium text-amber-400 hover:text-amber-300';

/** Round avatar chip mirroring Avatar.astro (md size): image or initial. */
function AvatarChip({
  userId,
  contentType,
  name,
}: {
  userId: number;
  contentType: string | null;
  name: string;
}): ReactNode {
  return (
    <Show
      when={contentType}
      fallback={
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-900 text-base font-semibold text-zinc-400"
        >
          {name.charAt(0).toUpperCase()}
        </span>
      }
    >
      <img
        src={`/api/avatars/${userId}`}
        alt={`${name}'s picture`}
        loading="lazy"
        className="h-12 w-12 shrink-0 rounded-full object-cover"
      />
    </Show>
  );
}

export function NavDrawer({ user, avatarContentType, canSubmit }: NavDrawerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // md:hidden hides the whole island above the breakpoint — if the
    // viewport crosses to desktop while open, the drawer would stay open
    // but unreachable; dismiss rather than leave the page scroll-locked.
    const atDesktop = window.matchMedia('(min-width: 768px)');
    const onDesktop = (event: MediaQueryListEvent): void => {
      if (event.matches) setOpen(false);
    };
    atDesktop.addEventListener('change', onDesktop);
    return () => {
      window.removeEventListener('keydown', onKey);
      atDesktop.removeEventListener('change', onDesktop);
    };
  }, [open]);

  // Lock body scroll while open; the restore reads the pre-open value so
  // nothing else's inline style is clobbered.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Focus moves into the drawer on open, back to the hamburger on close —
  // wasOpen skips the initial mount so page load never steals focus.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      panelRef.current?.focus();
      return;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      hamburgerRef.current?.focus();
    }
  }, [open]);

  const close = (): void => setOpen(false);

  return (
    <>
      <button
        ref={hamburgerRef}
        type="button"
        aria-label="open menu"
        aria-haspopup="dialog"
        aria-controls={PANEL_ID}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="rounded p-2 text-zinc-300 hover:bg-zinc-900 hover:text-white"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <Show when={open}>
        <div className="fixed inset-0 z-50">
          <div
            data-testid="drawer-overlay"
            aria-hidden="true"
            onClick={close}
            className="absolute inset-0 bg-black/70 motion-safe:animate-[nav-drawer-fade_150ms_ease-out]"
          />
          <div
            ref={panelRef}
            id={PANEL_ID}
            role="dialog"
            aria-modal="true"
            aria-label="menu"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-zinc-950 shadow-2xl outline-none motion-safe:animate-[nav-drawer-in_180ms_ease-out]"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <span className="text-lg font-semibold tracking-tight text-zinc-100">
                Bum
                <span className="ml-2 text-sm font-normal text-zinc-500">album review club</span>
              </span>
              <button
                type="button"
                aria-label="close menu"
                onClick={close}
                className="rounded p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <Switch>
                <Match when={user}>
                  <a href="/profile" onClick={close} className="flex items-center gap-3 rounded-lg p-2 hover:bg-zinc-900">
                    <AvatarChip userId={user?.id ?? 0} contentType={avatarContentType} name={user?.displayName ?? ''} />
                    <span className="font-medium text-zinc-100">{user?.displayName ?? ''}</span>
                  </a>
                </Match>
                <Match when={user === null}>
                  <div className="flex flex-col px-2">
                    <a href="/login" onClick={close} className="rounded px-1 py-2 text-sm text-zinc-300 hover:text-white">
                      log in
                    </a>
                    <a href="/signup" onClick={close} className="rounded px-1 py-2 text-sm text-zinc-300 hover:text-white">
                      sign up
                    </a>
                  </div>
                </Match>
              </Switch>
              <nav aria-label="main" className="mt-2 flex flex-col gap-1 border-t border-zinc-800 pt-3">
                <a href="/" onClick={close} className={item}>
                  dashboard
                </a>
                <a href="/albums" onClick={close} className={item}>
                  albums
                </a>
                <Show when={user}>
                  <a href="/profile" onClick={close} className={item}>
                    profile
                  </a>
                  <a href="/backlog" onClick={close} className={item}>
                    backlog
                  </a>
                </Show>
                <Show when={canSubmit && user !== null}>
                  <a href="/submit" onClick={close} className={amberItem}>
                    submit your pick
                  </a>
                </Show>
                <Show when={user?.isAdmin}>
                  <a href="/admin" onClick={close} className={item}>
                    admin
                  </a>
                </Show>
              </nav>
            </div>
            <Show when={user}>
              <form method="post" action="/api/logout" className="border-t border-zinc-800 p-4">
                <button type="submit" className="text-sm text-zinc-500 underline hover:text-zinc-300">
                  log out
                </button>
              </form>
            </Show>
          </div>
        </div>
      </Show>
    </>
  );
}

export default NavDrawer;
