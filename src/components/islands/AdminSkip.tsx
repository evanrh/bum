import { useState } from 'react';

import { Show } from '../react/Show.tsx';

export type AdminQueueEntry = { id: number; name: string };

export type AdminSkipProps = {
  week: string;
  pickerName: string;
  nextPickerName: string;
  /** True when the current picker already submitted (the API warns). */
  hasAlbum?: boolean;
  /** The current rotation, for the arbitrary picker override (issue #17). */
  queue: AdminQueueEntry[];
};

/** Reload after a successful mutation so server state is authoritative. */
const refresh = (delayMs: number): void => {
  setTimeout(() => window.location.reload(), delayMs);
};

export function AdminSkip({ week, pickerName, nextPickerName, hasAlbum, queue }: AdminSkipProps) {
  const [pending, setPending] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const selected = queue.find((entry) => String(entry.id) === selectedId);

  const act = async (
    guard: () => boolean,
    request: () => Promise<Response>,
  ): Promise<void> => {
    if (pending) return;
    if (!guard()) return;
    setPending(true);
    setError(null);
    try {
      const response = await request();
      const payload = (await response.json().catch(() => ({}))) as {
        warning?: string; moved?: { displayName: string }; picker?: { displayName: string } | null; error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? `rotation change failed (${response.status})`);
        setPending(false);
        return;
      }
      setWarning(payload.warning ?? null);
      // Brief pause so the warning is visible, then refresh server state.
      refresh(payload.warning ? 1600 : 0);
    } catch {
      setError('network error — try again');
      setPending(false);
    }
  };

  const skip = (): Promise<void> =>
    act(
      () => window.confirm(
        `Skip ${pickerName}'s turn? ${pickerName} moves to the back; ${nextPickerName} picks for the rest of week ${week}.`,
      ),
      () => fetch('/api/admin/rotation/skip', { method: 'POST' }),
    );

  const select = (): Promise<void> =>
    act(
      () => !!selected && window.confirm(
        `Set ${selected.name} as this week's picker? They move to the front of the rotation; everyone else keeps their current order.`,
      ),
      () => fetch('/api/admin/rotation/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: selected!.id }),
      }),
    );

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-sm text-zinc-300">
        week of {week} — <span className="font-semibold">{pickerName}</span> picks
      </p>
      <Show when={hasAlbum}>
        <p className="mt-1 text-xs text-amber-400" role="status">
          {pickerName} already submitted this week — skipping keeps the album and lets {nextPickerName} in.
        </p>
      </Show>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void skip()}
          disabled={pending}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
        >
          {pending ? 'working…' : 'skip current picker'}
        </button>
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
        >
          <option value="">override to…</option>
          {queue.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
              {entry.name === pickerName ? ' (current)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void select()}
          disabled={pending || !selected}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
        >
          make picker
        </button>
      </div>
      <Show when={warning}>
        <p className="mt-2 text-sm text-amber-400" role="alert">{warning}</p>
      </Show>
      <Show when={error}>
        <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>
      </Show>
    </div>
  );
}

export default AdminSkip;
