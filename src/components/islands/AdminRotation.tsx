import { useState } from 'react';

import { useDragOrder } from './useDragOrder.ts';
import { Show } from '../react/Show.tsx';

export type AdminRotationProps = {
  queue: Array<{ id: number; name: string }>;
};

/**
 * Ordered rotation list (issue #25): rows reorder by drag with a live swap
 * preview; keyboard users get the labelled ▲/▼ buttons. Nothing is saved
 * until "save order" is pressed — the button only appears once the list has
 * actually drifted from its confirmed order (or a save failed and a retry
 * is expected). Each save POSTs the whole queue (exact active member set).
 */
export function AdminRotation({ queue: initial }: AdminRotationProps) {
  const [error, setError] = useState<string | null>(null);
  const order = useDragOrder({
    initial,
    idOf: (member) => member.id,
    save: async (items): Promise<boolean> => {
      try {
        const response = await fetch('/api/admin/rotation/order', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ queue: items.map((member) => member.id) }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          setError(payload.error ?? `saving failed (${response.status})`);
          return false;
        }
        setError(null);
        return true;
      } catch {
        setError('network error — try again');
        return false;
      }
    },
  });

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="flex justify-end px-4 pt-2.5">
        <Show when={order.canSave}>
          <button
            type="button"
            disabled={order.saving}
            onClick={() => void order.save()}
            className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
          >
            {order.saving ? 'saving…' : 'save order'}
          </button>
        </Show>
      </div>
      <ol className="divide-y divide-zinc-800">
        {order.items.map((member, index) => (
          <li
            key={member.id}
            draggable={!order.saving}
            onDragStart={(event) => order.onDragStart(index, event)}
            onDragOver={(event) => order.onDragOver(index, event)}
            onDragEnd={(event) => order.onDragEnd(event)}
            className={`flex items-center justify-between px-4 py-2.5 text-sm ${index === order.dragged ? 'opacity-50' : ''}`}
          >
            <span className="text-zinc-300">
              <span className="mr-2 text-zinc-600">{index + 1}.</span>
              <span
                className="cursor-grab select-none"
                title="drag to reorder (or use the arrows)"
              >
                {member.name}
              </span>
              {index === 0 && <span className="ml-2 text-xs text-amber-400">picks this week</span>}
            </span>
            <span className="flex gap-1" aria-label={`reorder ${member.name} with the keyboard`}>
              <button type="button" disabled={order.saving || index === 0} onClick={() => order.move(index, -1)}
                className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30" aria-label={`move ${member.name} up`}>▲</button>
              <button type="button" disabled={order.saving || index === order.items.length - 1} onClick={() => order.move(index, 1)}
                className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30" aria-label={`move ${member.name} down`}>▼</button>
            </span>
          </li>
        ))}
      </ol>
      <Show when={order.failHintVisible}>
        <p className="px-4 pb-1 text-xs text-amber-400">save failed — press save order again to retry.</p>
      </Show>
      <Show when={error}>
        <p className="px-4 pb-3 text-xs text-red-300" role="alert">{error}</p>
      </Show>
    </div>
  );
}

export default AdminRotation;
