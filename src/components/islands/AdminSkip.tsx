import { useState } from 'react';

export type AdminSkipProps = {
  week: string;
  pickerName: string;
  nextPickerName: string;
  /** True when the current picker already submitted (the API warns). */
  hasAlbum?: boolean;
};

/** Always-enabled skip — each press is one logged rotation step. */
export function AdminSkip({ week, pickerName, nextPickerName, hasAlbum }: AdminSkipProps) {
  const [pending, setPending] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const skip = async (): Promise<void> => {
    if (pending) return;
    if (!window.confirm(
      `Skip ${pickerName}'s turn? ${pickerName} moves to the back; ${nextPickerName} picks for the rest of week ${week}.`,
    )) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/rotation/skip', { method: 'POST' });
      const payload = (await response.json().catch(() => ({}))) as {
        warning?: string; moved?: { displayName: string }; picker?: { displayName: string } | null; error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? `skip failed (${response.status})`);
        setPending(false);
        return;
      }
      setWarning(payload.warning ?? null);
      // Brief pause so the warning is visible, then refresh server state.
      setTimeout(() => window.location.reload(), payload.warning ? 1600 : 0);
    } catch {
      setError('network error — try again');
      setPending(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-sm text-zinc-300">
        week of {week} — <span className="font-semibold">{pickerName}</span> picks
      </p>
      {hasAlbum && (
        <p className="mt-1 text-xs text-amber-400" role="status">
          {pickerName} already submitted this week — skipping keeps the album and lets {nextPickerName} in.
        </p>
      )}
      <button
        type="button"
        onClick={() => void skip()}
        disabled={pending}
        className="mt-3 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
      >
        {pending ? 'skipping…' : 'skip current picker'}
      </button>
      {warning && <p className="mt-2 text-sm text-amber-400" role="alert">{warning}</p>}
      {error && <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>}
    </div>
  );
}

export default AdminSkip;
