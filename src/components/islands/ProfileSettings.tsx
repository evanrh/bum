import { useState, type ReactNode } from 'react';

import { reloadPage } from '../../lib/reload.ts';
import { Show } from '../react/Show.tsx';

/**
 * /profile/settings editor (issue #50): display name, password, and profile
 * picture, each its own card with an independent pending state. The picture
 * upload posts multipart (the only FormData consumer in the app); after any
 * success the page reloads so the header chip and previews pick up the new
 * state. A password change logs the member out everywhere → `/login`.
 */

const jsonPost = async (path: string, body: unknown): Promise<Response> =>
  await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const avatarDelete = async (): Promise<Response> =>
  await fetch('/api/profile/avatar', { method: 'DELETE' });

export type ProfileSettingsProps = {
  username: string;
  initialDisplayName: string;
  /** avatars.updated_at — non-null ⇒ a picture exists and ?v= busts the cache. */
  avatarVersion: number | null;
  userId: number;
};

type Pending = 'idle' | 'displayName' | 'password' | 'upload' | 'remove';

/** Mirrors the server limit — the request is pre-screened before upload. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const card = 'rounded-xl border border-zinc-800 bg-zinc-900 p-5';
const input = 'mt-1 block w-full rounded bg-zinc-950 px-3 py-2 text-zinc-100';
const button =
  'rounded bg-zinc-100 px-3 py-2 font-medium text-zinc-900 hover:bg-white disabled:opacity-50';

export function ProfileSettings({
  username,
  initialDisplayName,
  avatarVersion,
  userId,
}: ProfileSettingsProps): ReactNode {
  const [pending, setPending] = useState<Pending>('idle');
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const readError = async (response: Response, fallback: string): Promise<string> => {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return body.error ?? fallback;
  };

  const saveDisplayName = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending !== 'idle') return;
    setPending('displayName');
    setError(null);
    try {
      const response = await jsonPost('/api/profile/display-name', { display_name: displayName });
      if (response.ok) {
        reloadPage();
        return;
      }
      setError(await readError(response, `rename failed (${response.status})`));
    } catch {
      setError('network error — try again');
    } finally {
      setPending('idle');
    }
  };

  const savePassword = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending !== 'idle') return;
    setPending('password');
    setError(null);
    try {
      const response = await jsonPost('/api/profile/password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      if (response.ok) {
        // Every session for this member is dead — including this browser.
        window.location.assign('/login');
        return;
      }
      setError(await readError(response, `password change failed (${response.status})`));
    } catch {
      setError('network error — try again');
    } finally {
      setPending('idle');
    }
  };

  const saveAvatar = async (): Promise<void> => {
    if (pending !== 'idle') return;
    if (!file) {
      setError('choose a picture first');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError('profile picture too large — 2 MB max');
      return;
    }
    setPending('upload');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/profile/avatar', { method: 'POST', body: form });
      if (response.ok) {
        reloadPage();
        return;
      }
      setError(await readError(response, `upload failed (${response.status})`));
    } catch {
      setError('network error — try again');
    } finally {
      setPending('idle');
    }
  };

  const deleteAvatar = async (): Promise<void> => {
    if (pending !== 'idle') return;
    setPending('remove');
    setError(null);
    try {
      const response = await avatarDelete();
      if (response.ok) {
        setFile(null);
        reloadPage();
        return;
      }
      setError(await readError(response, `removing the picture failed (${response.status})`));
    } catch {
      setError('network error — try again');
    } finally {
      setPending('idle');
    }
  };

  const hasAvatar = avatarVersion !== null;

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <Show when={error}>
        <p className="rounded border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      </Show>

      <form className={card} onSubmit={(event) => void saveDisplayName(event)}>
        <h2 className="mb-1 text-sm font-semibold tracking-wide text-zinc-500 uppercase">display name</h2>
        <p className="mb-3 text-xs text-zinc-500">signed in as @{username} — the username itself is fixed.</p>
        <label className="text-sm text-zinc-300">
          shown next to your ratings
          <input
            name="display_name"
            required
            autoComplete="nickname"
            maxLength={64}
            value={displayName}
            disabled={pending !== 'idle'}
            onInput={(event) => setDisplayName((event.target as HTMLInputElement).value)}
            className={input}
          />
        </label>
        <button type="submit" disabled={pending !== 'idle'} className={`mt-3 ${button}`}>
          {pending === 'displayName' ? 'saving…' : 'save name'}
        </button>
      </form>

      <form className={card} onSubmit={(event) => void savePassword(event)}>
        <h2 className="mb-1 text-sm font-semibold tracking-wide text-zinc-500 uppercase">password</h2>
        <label className="text-sm text-zinc-300">
          current password
          <input
            type="password"
            name="current_password"
            required
            autoComplete="current-password"
            value={currentPassword}
            disabled={pending !== 'idle'}
            onInput={(event) => setCurrentPassword((event.target as HTMLInputElement).value)}
            className={input}
          />
        </label>
        <label className="mt-3 text-sm text-zinc-300">
          new password (at least 8 characters)
          <input
            type="password"
            name="new_password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            disabled={pending !== 'idle'}
            onInput={(event) => setNewPassword((event.target as HTMLInputElement).value)}
            className={input}
          />
        </label>
        <button type="submit" disabled={pending !== 'idle'} className={`mt-3 ${button}`}>
          {pending === 'password' ? 'changing…' : 'change password'}
        </button>
        <p className="mt-2 text-xs text-zinc-500">changing it signs you out everywhere, including here.</p>
      </form>

      <div className={card}>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-zinc-500 uppercase">profile picture</h2>
        <div className="flex items-center gap-4">
          <Show
            when={hasAvatar}
            fallback={
              <span
                aria-hidden="true"
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-900 text-xl font-semibold text-zinc-400"
              >
                {initialDisplayName.charAt(0).toUpperCase()}
              </span>
            }
          >
            <img
              src={`/api/avatars/${userId}?v=${avatarVersion}`}
              alt="your picture"
              className="h-16 w-16 shrink-0 rounded-full object-cover"
              data-testid="avatar-preview"
            />
          </Show>
          <div className="text-sm text-zinc-500">
            PNG, JPEG, or WebP — up to 2 MB. Square works best.
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* The visible button just opens the picker; the upload posts the file. */}
          <label className="cursor-pointer rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:text-white">
            choose image…
            <input
              type="file"
              name="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={pending !== 'idle'}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button type="button" disabled={pending !== 'idle' || file === null} onClick={() => void saveAvatar()} className={button}>
            {pending === 'upload' ? 'uploading…' : 'upload picture'}
          </button>
          <Show when={hasAvatar}>
            <button
              type="button"
              disabled={pending !== 'idle'}
              onClick={() => void deleteAvatar()}
              className="rounded px-3 py-2 text-sm text-zinc-400 underline hover:text-zinc-200"
            >
              {pending === 'remove' ? 'removing…' : 'remove picture'}
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default ProfileSettings;
