import { useState } from 'react';

import { Show } from '../react/Show.tsx';

export type AdminBacklogFillProps = {
  week: string;
  pickerName: string;
};

/** Reload after a successful mutation so server state is authoritative. */
const refresh = (delayMs: number): void => {
  setTimeout(() => window.location.reload(), delayMs);
};

export function AdminBacklogFill({ week, pickerName }: AdminBacklogFillProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fill = async (): Promise<void> => {
    if (pending) return;
    if (!window.confirm(`Use ${pickerName}'s backlog head for week ${week}? Like the weekly advance — the queue is not changed.`)) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/rotation/backlog-fill', { method: 'POST' });
      const payload = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
      if (!response.ok) {
        setError(payload.error ?? `backlog fill failed (${response.status})`);
        setPending(false);
        return;
      }
      // Pause briefly so the outcome is visible before the reload.
      setMessage(payload.detail ?? 'backlog item submitted');
      refresh(1600);
    } catch {
      setError('network error — try again');
      setPending(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-sm text-zinc-300">
        or make <span className="font-semibold">{pickerName}</span>'s queued head item pick for week {week} — no rotation change
      </p>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => void fill()}
          disabled={pending}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
        >
          {pending ? 'working…' : 'fill from backlog'}
        </button>
      </div>
      <Show when={message}>
        <p className="mt-2 text-sm text-amber-400" role="status">{message}</p>
      </Show>
      <Show when={error}>
        <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>
      </Show>
    </div>
  );
}

export default AdminBacklogFill;
