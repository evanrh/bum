import { useState, type ReactNode } from 'react';

import { reloadPage } from '../../lib/reload.ts';
import { Show } from '../react/Show.tsx';

export type RatingWidgetProps = {
  albumId: string;
  /** Stored integer (half-stars × 2, 1–10); 7 = 3.5★ on the 5-star scale. */
  initialScore?: number | null;
  initialComment?: string | null;
};

const STARS = 5;                       // the visible 5-star scale…
const HALVES = STARS * 2;              // …with half-star steps (stored 1–10)
const COMMENT_MAX = 2000;              // mirrors the API's Zod limit
type Pending = 'idle' | 'save' | 'delete';

type StarRowProps = {
  /** Half-stars × 2 — drives the fill width and the read-only aria label. */
  score: number | null;
  /** Editable: overlays one click target per half-star; otherwise only shows. */
  interactive: boolean;
  busy?: boolean;
  onSelect?: (score: number) => void;
};

function StarRow({ score, interactive, busy = false, onSelect }: StarRowProps): ReactNode {
  const fillPct = ((score ?? 0) / HALVES) * 100;
  const label = (score ?? 0) > 0 ? `${(score ?? 0) / 2} stars` : 'not rated';
  const halves = Array.from({ length: HALVES }, (_, i) => i + 1);
  return (
    <div
      className="relative inline-flex leading-none"
      role={interactive ? 'group' : 'img'}
      aria-label={interactive ? 'rate this album' : label}
    >
      <span aria-hidden="true" className="rating-stars whitespace-nowrap text-zinc-700">★★★★★</span>
      <span
        aria-hidden="true"
        className="star-display-fill absolute left-0 top-0 overflow-hidden whitespace-nowrap text-amber-400"
        style={{ width: `${fillPct}%` }}
      >★★★★★</span>
      {
        /* invisible click targets — one per half-star (each 1/10 of the row) */
        interactive ? (
          halves.map((segment) => (
            <button
              key={segment}
              type="button"
              disabled={busy}
              aria-label={`${segment / 2} stars`}
              title={`rate ${segment / 2} stars`}
              onClick={() => onSelect?.(segment)}
              className="rating-half absolute top-0 h-full w-[10%] cursor-pointer opacity-0 hover:bg-white/10 focus-visible:bg-white/10"
              style={{ left: `${((segment - 1) / HALVES) * 100}%` }}
            />
          ))
        ) : null
      }
    </div>
  );
}

/**
 * Half-star rating widget on the visible 5-star scale for the dashboard and
 * album detail. An existing rating renders read-only (slightly grayed with
 * an explicit edit button); saving or deleting reloads the page so the
 * surrounding stats pick up the change. Rollback on API errors;
 * double-press guarded.
 */
export function RatingWidget({ albumId, initialScore = null, initialComment = null }: RatingWidgetProps) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [comment, setComment] = useState(initialComment ?? '');
  const [pending, setPending] = useState<Pending>('idle');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(initialScore === null || initialScore === undefined);

  const busy = pending !== 'idle';

  const enterEdit = (): void => {
    setScore(initialScore);
    setComment(initialComment ?? '');
    setError(null);
    setEditing(true);
  };

  /** Leave edit mode and restore the saved rating (the read-only view). */
  const backToView = (): void => {
    setScore(initialScore);
    setComment(initialComment ?? '');
    setError(null);
    setPending('idle');
    setEditing(false);
  };

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
    const prevScore = score;
    const prevComment = comment;
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
      // Full reload on purpose: avg, count, and the activity feed are all
      // server-rendered, so the new rating only lands via a fresh GET.
      reloadPage();
    } catch {
      rollback(prevScore, prevComment, 'network error — try again');
    }
  };

  const remove = async (): Promise<void> => {
    if (busy) return;
    if (!window.confirm('Delete your rating?')) return;
    const prevScore = score;
    const prevComment = comment;
    setPending('delete');
    setError(null);
    try {
      const response = await fetch(`/api/ratings?album_id=${encodeURIComponent(albumId)}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        rollback(prevScore, prevComment, body.error ?? `delete failed (${response.status})`);
        return;
      }
      // Reload like save: the stats and ratings list change with the deletion.
      reloadPage();
    } catch {
      rollback(prevScore, prevComment, 'network error — try again');
    }
  };

  return (
    <div className="rating-widget rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <Show
        when={editing}
        fallback={
          <div className="rating-widget-view">
            <div className="rating-readonly flex items-center gap-2 opacity-60">
              <StarRow score={score} interactive={false} />
              <Show when={(score ?? 0) > 0}>
                <span className="text-sm text-zinc-300">{(score ?? 0) / 2}★</span>
              </Show>
            </div>
            <Show when={comment.trim() !== ''}>
              <p className="rating-readonly-comment mt-2 rounded bg-zinc-950 px-3 py-2 text-sm text-zinc-300 opacity-60 whitespace-pre-wrap">
                {comment}
              </p>
            </Show>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={enterEdit}
                disabled={busy}
                className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
              >
                edit rating
              </button>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="text-sm text-zinc-500 underline hover:text-red-300 disabled:opacity-50"
              >
                {pending === 'delete' ? 'deleting…' : 'delete'}
              </button>
            </div>
            <Show when={error}>
              <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>
            </Show>
          </div>
        }
      >
        <div className="rating-widget-edit">
          <StarRow score={score} interactive busy={busy} onSelect={setScore} />
          <Show when={score !== null}>
            <p className="mt-1 text-xs text-zinc-400">
              selected: <span className="rating-score-label">{(score ?? 0) / 2}★</span>
            </p>
          </Show>
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
              className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
            >
              {pending === 'save' ? 'saving…' : 'save rating'}
            </button>
            <Show when={initialScore !== null && initialScore !== undefined}>
              <button
                type="button"
                onClick={backToView}
                disabled={busy}
                className="text-sm text-zinc-500 underline hover:text-zinc-300 disabled:opacity-50"
              >
                cancel
              </button>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default RatingWidget;
