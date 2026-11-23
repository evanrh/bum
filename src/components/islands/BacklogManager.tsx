import { useState } from 'react';

import { albumInputSchema } from '../../lib/albums.ts';
import { useDragOrder } from './useDragOrder.ts';
import { AlbumCard } from '../react/AlbumCard.tsx';
import { Show } from '../react/Show.tsx';

export type BacklogRow = {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  spotifyId: string | null;
  youtubeId: string | null;
  coverUrl: string | null;
  note: string | null;
};

export type BacklogManagerProps = {
  items: BacklogRow[];
  autoBacklog: boolean;
};

const textInput = 'mt-1 block w-full rounded bg-zinc-900 px-3 py-2 text-zinc-100';
const errorNote = 'text-xs text-red-300';
type Draft = Record<string, string>;

/** Coerce the raw stringy draft into the shape the Zod schema expects. */
const normalize = (values: Draft): Record<string, unknown> => ({
  ...values,
  year: values.year === '' || values.year === undefined ? undefined : Number(values.year),
});

const collectFieldErrors = (
  result: { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } },
): Record<string, string> => {
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
};

export function BacklogManager({ items: initial, autoBacklog: autoInitial }: BacklogManagerProps) {
  const [autoBacklog, setAutoBacklog] = useState(autoInitial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Draft>({
    title: '', artist: '', year: '', spotify_url: '', youtube_url: '', note: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const field = (key: string) =>
    (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      setValues({ ...values, [key]: (event.target as HTMLInputElement).value });
      setFieldErrors({});
    };

  // Reordering (issue #25): local until "save order" — the save button only
  // shows when the queue has actually drifted (or a save failed). Add/remove
  // below commit immediately and hand their result to order.reset().
  const order = useDragOrder({
    initial,
    idOf: (item) => item.id,
    save: async (list): Promise<boolean> => {
      try {
        const response = await fetch('/api/backlog/order', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: list.map((item) => item.id) }),
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

  const remove = async (id: string): Promise<void> => {
    if (pending) return;
    if (!window.confirm('remove this album from your backlog?')) return;
    const before = order.items;
    order.reset(before.filter((item) => item.id !== id));
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/backlog/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        order.reset(before);
        setError(payload.error ?? `remove failed (${response.status})`);
      }
    } catch {
      order.reset(before);
      setError('network error — try again');
    } finally {
      setPending(false);
    }
  };

  const toggleAuto = async (): Promise<void> => {
    if (pending) return;
    const wanted = !autoBacklog;
    setAutoBacklog(wanted);
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/backlog/auto-queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: wanted }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setAutoBacklog(!wanted);
        setError(payload.error ?? `saving failed (${response.status})`);
      }
    } catch {
      setAutoBacklog(!wanted);
      setError('network error — try again');
    } finally {
      setPending(false);
    }
  };

  const add = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    const draft = normalize(values);
    const check = albumInputSchema.safeParse(draft);
    if (!check.success) {
      setFieldErrors(collectFieldErrors(check));
      return;
    }
    setFieldErrors({});
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/backlog', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (response.ok) {
        const created = (await response.json()) as BacklogRow;
        // The server appended behind the CONFIRMED queue; a local unsaved
        // reorder is dropped by this commit (add/remove are always commits).
        order.reset([...order.saved, created]);
        setValues({ title: '', artist: '', year: '', spotify_url: '', youtube_url: '', note: '' });
      } else {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? `adding failed (${response.status})`);
      }
    } catch {
      setError('network error — try again');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4" aria-label="backlog settings">
        <label className="flex items-center gap-3 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={autoBacklog}
            disabled={pending}
            onChange={() => void toggleAuto()}
            className="size-4 accent-amber-400"
          />
          <span>
            auto-queue when your week starts
            <span className="ml-2 text-xs text-zinc-500">
              {autoBacklog ? 'on — your first queued album goes up automatically' : 'off — you submit manually as usual'}
            </span>
          </span>
        </label>
      </section>

      <section aria-label="queued albums">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
            your queue ({order.items.length} — unsaved reorders save on demand)
          </h2>
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
        <Show when={order.items.length === 0}>
          <p className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-500">
            nothing queued yet — add albums below and they'll be waiting for your weeks.
          </p>
        </Show>
        <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {order.items.map((item, index) => (
            <li
              key={item.id}
              draggable={!pending && !order.saving}
              onDragStart={(event) => order.onDragStart(index, event)}
              onDragOver={(event) => order.onDragOver(index, event)}
              onDragEnd={(event) => order.onDragEnd(event)}
              className={`cursor-grab ${index === order.dragged ? 'opacity-50' : ''}`}
              title="drag to reorder (or use the arrows)"
            >
              <AlbumCard
                title={item.title}
                artist={item.artist}
                year={item.year}
                coverUrl={item.coverUrl}
                note={item.note}
                nextUp={index === 0}
              >
                <span className="flex flex-none gap-1" aria-label={`reorder ${item.title} with the keyboard`}>
                  <button type="button" disabled={order.saving || pending || index === 0} onClick={() => order.move(index, -1)}
                    className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30"
                    aria-label={`move ${item.title} up`}>▲</button>
                  <button type="button" disabled={order.saving || pending || index === order.items.length - 1} onClick={() => order.move(index, 1)}
                    className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-30"
                    aria-label={`move ${item.title} down`}>▼</button>
                </span>
                <button
                  type="button"
                  onClick={() => void remove(item.id)}
                  disabled={pending || order.saving}
                  className="text-xs text-zinc-500 underline hover:text-red-300 disabled:opacity-50"
                >
                  remove
                </button>
              </AlbumCard>
            </li>
          ))}
        </ol>
        <Show when={order.failHintVisible}>
          <p className="mt-2 text-xs text-amber-400">save failed — press save order again to retry.</p>
        </Show>
        <Show when={error}>
          <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>
        </Show>
      </section>

      <section aria-label="add to backlog" className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-zinc-500 uppercase">queue another album</h2>
        <form className="flex max-w-md flex-col gap-3" onSubmit={(event) => void add(event)}>
          <Show when={error}>
            <p className="rounded border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-300" role="alert">
              {error}
            </p>
          </Show>
          {(
            [
              ['title', 'title', 'text'],
              ['artist', 'artist', 'text'],
              ['year', 'year (1900–2100, optional)', 'number'],
              ['spotify_url', 'Spotify album URL (optional)', 'url'],
              ['youtube_url', 'YouTube video URL (optional)', 'url'],
            ] as const
          ).map(([name, label, type]) => (
            <div key={name}>
              <label className="text-sm text-zinc-300">
                {label}
                <input name={name} type={type} disabled={pending} value={values[name]} onInput={field(name)} className={textInput} />
              </label>
              <Show when={fieldErrors[name]}>
                <p className={errorNote}>{fieldErrors[name]}</p>
              </Show>
            </div>
          ))}
          <div>
            <label className="text-sm text-zinc-300">
              note (optional)
              <textarea name="note" rows={2} disabled={pending} value={values.note} onInput={field('note')} className={textInput} />
            </label>
            <Show when={fieldErrors.note}>
              <p className={errorNote}>{fieldErrors.note}</p>
            </Show>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-zinc-100 px-3 py-2 font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
          >
            {pending ? 'working…' : 'add to backlog'}
          </button>
        </form>
      </section>
    </div>
  );
}

export default BacklogManager;
