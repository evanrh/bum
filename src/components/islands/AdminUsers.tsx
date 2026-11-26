import { useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faKey,
  faLock,
  faUserCheck,
  faUserMinus,
  faUserPlus,
  faUserSlash,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';

import { Match } from '../react/Match.tsx';
import { Show } from '../react/Show.tsx';
import { Switch } from '../react/Switch.tsx';
import { Tooltip } from '../react/Tooltip.tsx';

export type AdminUserRow = {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
  isOriginalAdmin: boolean;
  isActive: boolean;
  joinedAt: number;
  submissionCount: number;
  ratingCount: number;
};

const LOCKED_LABEL = 'the first member ever — permanently admin';

type IconButtonProps = {
  icon: IconDefinition;
  tip: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
};

/** Icon-only action — tip/title carry the bare action word, `aria-label` the row name (issues #53, #58). */
function IconButton({ icon, tip, label, disabled, onClick }: IconButtonProps): ReactNode {
  return (
    <Tooltip text={tip}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        title={tip}
        aria-label={label}
        className="flex h-7 w-7 items-center justify-center rounded border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
      >
        <FontAwesomeIcon icon={icon} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

export function AdminUsers({ users: initial }: { users: AdminUserRow[] }): ReactNode {
  const [users, setUsers] = useState(initial);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const act = async (user: AdminUserRow, action: string, body?: Record<string, unknown>): Promise<void> => {
    if (busyId !== null) return; // double-press guard
    setBusyId(user.id);
    setRowErrors((errors) => ({ ...errors, [user.id]: '' }));
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setRowErrors((errors) => ({ ...errors, [user.id]: payload.error ?? `action failed (${response.status})` }));
        return;
      }
      const payload = (await response.json()) as { user: AdminUserRow };
      setUsers((current) => current.map((row) => (row.id === payload.user.id ? { ...row, ...payload.user } : row)));
    } catch {
      setRowErrors((errors) => ({ ...errors, [user.id]: 'network error — try again' }));
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (user: AdminUserRow): Promise<void> => {
    const password = window.prompt(`new password for ${user.username} (min 8 chars):`);
    if (password === null) return;
    await act(user, 'reset_password', { password });
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
      <table className="w-full text-sm">
        <thead className="text-left text-xs tracking-wide text-zinc-500 uppercase">
          <tr>
            <th className="px-4 py-3">member</th>
            <th className="px-4 py-3">picks</th>
            <th className="px-4 py-3">ratings</th>
            <th className="px-4 py-3">role</th>
            <th className="px-4 py-3">actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {users.map((user) => (
            <tr key={user.id} className={user.isActive ? '' : 'opacity-50'}>
              <td className="px-4 py-3">
                <span className="font-medium text-zinc-200">{user.displayName}</span>{' '}
                <span className="text-xs text-zinc-500">@{user.username}</span>
                <Show when={!user.isActive}>
                  <span className="ml-2 text-xs text-red-300">deactivated — loses login; history stays</span>
                </Show>
              </td>
              <td className="px-4 py-3 text-zinc-400">{user.submissionCount}</td>
              <td className="px-4 py-3 text-zinc-400">{user.ratingCount}</td>
              <td className="px-4 py-3 text-zinc-400">
                {user.isAdmin
                  ? user.isOriginalAdmin ? 'original admin' : 'admin'
                  : 'member'}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Switch>
                    <Match when={user.isAdmin && user.isOriginalAdmin}>
                      <Tooltip text="Original admin">
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded border border-amber-500/50 text-xs text-amber-400"
                          title="Original admin"
                          aria-label={LOCKED_LABEL}
                          role="img"
                        >
                          <FontAwesomeIcon icon={faLock} aria-hidden="true" />
                        </span>
                      </Tooltip>
                    </Match>
                    <Match when={user.isAdmin}>
                      <IconButton
                        icon={faUserMinus}
                        tip="Demote"
                        label={`demote ${user.username}`}
                        disabled={busyId !== null}
                        onClick={() => void act(user, 'demote')}
                      />
                    </Match>
                    <Match when={!user.isAdmin}>
                      <IconButton
                        icon={faUserPlus}
                        tip="Promote"
                        label={`promote ${user.username}`}
                        disabled={busyId !== null}
                        onClick={() => void act(user, 'promote')}
                      />
                    </Match>
                  </Switch>
                  <Show
                    when={user.isActive}
                    fallback={
                      <IconButton
                        icon={faUserCheck}
                        tip="Activate"
                        label={`activate ${user.username}`}
                        disabled={busyId !== null}
                        onClick={() => void act(user, 'activate')}
                      />
                    }
                  >
                    <IconButton
                      icon={faUserSlash}
                      tip="Deactivate"
                      label={`deactivate ${user.username}`}
                      disabled={busyId !== null}
                      onClick={() => void act(user, 'deactivate')}
                    />
                  </Show>
                  <IconButton
                    icon={faKey}
                    tip="Reset password"
                    label={`reset ${user.username}'s password`}
                    disabled={busyId !== null}
                    onClick={() => void resetPassword(user)}
                  />
                </div>
                <Show when={rowErrors[user.id]}>
                  <p className="mt-1 text-xs text-red-300" role="alert">{rowErrors[user.id]}</p>
                </Show>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default AdminUsers;
