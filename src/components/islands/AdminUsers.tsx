import { useState } from 'react';

export type AdminUserRow = {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
  isActive: boolean;
  joinedAt: number;
  submissionCount: number;
  ratingCount: number;
  queuePosition: number | null;
};

export function AdminUsers({ users: initial }: { users: AdminUserRow[] }) {
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
            <th className="px-4 py-3">queue</th>
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
                {!user.isActive && <span className="ml-2 text-xs text-red-300">deactivated — loses login; history stays</span>}
              </td>
              <td className="px-4 py-3 text-zinc-400">{user.queuePosition ?? '—'}</td>
              <td className="px-4 py-3 text-zinc-400">{user.submissionCount}</td>
              <td className="px-4 py-3 text-zinc-400">{user.ratingCount}</td>
              <td className="px-4 py-3 text-zinc-400">{user.isAdmin ? 'admin' : 'member'}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {user.isAdmin ? (
                    <button type="button" disabled={busyId !== null} onClick={() => void act(user, 'demote')}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
                      demote
                    </button>
                  ) : (
                    <button type="button" disabled={busyId !== null} onClick={() => void act(user, 'promote')}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
                      promote
                    </button>
                  )}
                  {user.isActive ? (
                    <button type="button" disabled={busyId !== null} onClick={() => void act(user, 'deactivate')}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
                      deactivate
                    </button>
                  ) : (
                    <button type="button" disabled={busyId !== null} onClick={() => void act(user, 'activate')}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
                      activate
                    </button>
                  )}
                  <button type="button" disabled={busyId !== null} onClick={() => void resetPassword(user)}
                    className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
                    reset password
                  </button>
                </div>
                {rowErrors[user.id] && (
                  <p className="mt-1 text-xs text-red-300" role="alert">{rowErrors[user.id]}</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default AdminUsers;
