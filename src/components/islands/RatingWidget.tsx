import { useState } from 'react';

import { Show } from '../react/Show.tsx';

export type RatingWidgetProps = {
  albumId: string;
  initialScore?: number | null;
  initialComment?: string | null;
};

const SEGMENTS = 10; // half-stars × 2 over 5 stars
const COMMENT_MAX = 2000; // mirrors the API's Zod limit
type Pending = 'idle' | 'save' | 'delete';

/**
 * Half-star rating input (10 segments over 5 stars) for the dashboard and
 * album detail. Optimistic save/delete with rollback on API errors;
 * double-press guarded.
 */
export function RatingWidget({ albumId, initialScore = null, initialComment = null }: RatingWidgetProps) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [comment, setComment] = useState(initialComment ?? '');
  const [pending, setPending] = useState<Pending>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(initialScore !== null && initialScore !== undefined);

  const busy = pending !== 'idle';

  const rollback = (prevScore: number | null, prevComment: string, message: string): void => {
    setScore(prevScore);
    setComment(prevComment);
    setError(message);
    setPending('idle');
  };

  const save = async (): Promise<void> => {
    if (busy) return;
    if (score === null) {
      setError('pick a score first');
      return;
    }
    const prevScore = initialScore ?? score;
    const prevComment = initialComment ?? comment;
    setPending('save');
    setError(null);
    try {
      const response = await fetch('/api/ratings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ album_id: albumId, score, comment: comment.trim() === '' ? undefined : comment }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        rollback(prevScore, prevComment, body.error ?? `saving failed (${response.status})`);
        return;
      }
      setSaved(true);
      setPending('idle');
    } catch {
      rollback(prevScore, prevComment, 'network error — try again');
    }
  };

  const remove = async (): Promise<void> => {
    if (busy) return;
    if (!window.confirm('Delete your rating?')) return;
    const prevScore = initialScore ?? score;
    const prevComment = initialComment ?? comment;
    setPending('delete');
    setError(null);
    try {
      const response = await fetch(`/api/ratings?album_id=${encodeURIComponent(albumId)}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        rollback(prevScore, prevComment, body.error ?? `delete failed (${response.status})`);
        return;
      }
      setScore(null);
      setComment('');
      setSaved(false);
      setPending('idle');
    } catch {
      rollback(prevScore, prevComment, 'network error — try again');
    }
  };

  return (
    <div className="rating-widget rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex flex-wrap gap-0.5" role="group" aria-label="rate this album">
        {Array.from({ length: SEGMENTS }, (_, i) => i + 1).map((segment) => (
          <button
            key={segment}
            type="button"
            disabled={busy}
            aria-label={`${segment / 2} stars`}
            title={`${segment / 2} stars`}
            onClick={() => setScore(segment)}
            className={`rating-segment ${segment <= (score ?? 0) ? 'rating-segment--on text-amber-400' : 'text-zinc-600 hover:text-zinc-400'}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={COMMENT_MAX}
        rows={2}
        placeholder="optional comment"
        disabled={busy}
        className="mt-2 w-full rounded bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      />
      <Show when={error}>
        <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>
      </Show>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || score === null}
          className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 disabled:opacity-50"
        >
          {pending === 'save' ? 'saving…' : 'save rating'}
        </button>
        <Show when={saved}>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="text-sm text-zinc-500 underline hover:text-red-300"
          >
            {pending === 'delete' ? 'deleting…' : 'delete'}
          </button>
        </Show>
      </div>
    </div>
  );
}

export default RatingWidget;
