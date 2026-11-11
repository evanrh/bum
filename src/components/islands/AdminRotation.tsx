import { useState } from 'react';

export type AdminRotationProps = {
  queue: Array<{ id: number; name: string }>;
};

/** Ordered rotation list — every move POSTs the whole queue (the API
 * validates it as exactly the active member set). Optimistic with rollback. */
export function AdminRotation({ queue: initial }: AdminRotationProps) {
  const [queue, setQueue] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = (index: number, delta: -1 | 1): void => {
    if (pending) return; // double-press guard
    const target = index + delta;
    if (target < 0 || target >= queue.length) return;
    const next = [...queue];
    [next[index], next[target]] = [next[target], next[index]];
    setQueue(next);
    setPending(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch('/api/admin/rotation/order', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ queue: next.map((member) => member.id) }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          setQueue(initial);
          setError(payload.error ?? `saving failed (${response.status})`);
        }
      } catch {
        setQueue(initial);
        setError('network error — try again');
      } finally {
        setPending(false);
      }
    })();
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900">
      <ol className="divide-y divide-zinc-800">
        {queue.map((member, index) => (
          <li key={member.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="text-zinc-300">
              <span className="mr-2 text-zinc-600">{index + 1}.</span>
              {member.name}
              {index === 0 && <span className="ml-2 text-xs text-amber-400">picks this week</span>}
            </span>
            <span className="flex gap-1">
              <button type="button" disabled={pending || index === 0} onClick={() => move(index, -1)}
                className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30" aria-label={`move ${member.name} up`}>▲</button>
              <button type="button" disabled={pending || index === queue.length - 1} onClick={() => move(index, 1)}
                className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30" aria-label={`move ${member.name} down`}>▼</button>
            </span>
          </li>
        ))}
      </ol>
      {error && <p className="px-4 pb-3 text-xs text-red-300" role="alert">{error}</p>}
    </div>
  );
}

export default AdminRotation;
