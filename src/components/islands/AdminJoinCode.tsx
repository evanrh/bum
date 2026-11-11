import { useState } from 'react';

export type AdminJoinCodeProps = {
  joiningEnabled: boolean;
};

/** Join-code rotation (plaintext shown exactly once) + the signup gate. */
export function AdminJoinCode({ joiningEnabled: initial }: AdminJoinCodeProps) {
  const [joining, setJoining] = useState(initial);
  const [freshCode, setFreshCode] = useState<string | null>(null);
  const [pending, setPending] = useState<'idle' | 'toggle' | 'rotate'>('idle');
  const [error, setError] = useState<string | null>(null);

  const regenerate = async (): Promise<void> => {
    if (pending !== 'idle') return;
    if (!window.confirm('Rotate the join code? The old code stops working immediately.')) return;
    setPending('rotate');
    setError(null);
    try {
      const response = await fetch('/api/admin/join-code', { method: 'POST' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? `rotation failed (${response.status})`);
        setPending('idle');
        return;
      }
      const payload = (await response.json()) as { join_code: string };
      setFreshCode(payload.join_code);
      setPending('idle');
    } catch {
      setError('network error — try again');
      setPending('idle');
    }
  };

  const toggle = async (): Promise<void> => {
    if (pending !== 'idle') return;
    setPending('toggle');
    setError(null);
    try {
      const response = await fetch('/api/admin/joining', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !joining }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? `toggle failed (${response.status})`);
        setPending('idle');
        return;
      }
      const payload = (await response.json()) as { joiningEnabled: boolean };
      setJoining(payload.joiningEnabled);
      setPending('idle');
    } catch {
      setError('network error — try again');
      setPending('idle');
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-300">
      <div className="flex flex-wrap items-center gap-3">
        <p>
          signups: <span className={joining ? 'font-medium text-emerald-400' : 'font-medium text-red-300'}>
            {joining ? 'open' : 'closed'}
          </span>
        </p>
        <button type="button" disabled={pending !== 'idle'} onClick={() => void toggle()}
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
          {joining ? 'close signups' : 'open signups'}
        </button>
        <button type="button" disabled={pending !== 'idle'} onClick={() => void regenerate()}
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
          {freshCode ? 'rotate again' : 'rotate join code'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>}
      {freshCode && (
        <div className="mt-3 rounded bg-zinc-950 px-3 py-2">
          <p className="text-xs text-zinc-500">new join code — shown once:</p>
          <code className="text-amber-400 select-all">{freshCode}</code>
          <p className="mt-1 text-xs text-zinc-500">won't be shown again — copy it now.</p>
        </div>
      )}
    </div>
  );
}

export default AdminJoinCode;
