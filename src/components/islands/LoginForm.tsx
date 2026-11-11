import { useState } from 'react';

const jsonPost = async (path: string, body: unknown): Promise<Response> =>
  await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** POST /api/login, inline errors, disabled-during-submit, redirect on success. */
export function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending) return; // double-press guard
    setPending(true);
    setError(null);
    try {
      const response = await jsonPost('/api/login', { username, password: password });
      if (response.ok) {
        window.location.assign('/');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `login failed (${response.status})`);
    } catch {
      setError('network error — try again');
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="flex max-w-sm flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {error && (
        <p className="rounded border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      <label className="text-sm text-zinc-300">
        username
        <input
          name="username"
          required
          autoComplete="username"
          disabled={pending}
          onInput={(event) => setUsername((event.target as HTMLInputElement).value)}
          className="mt-1 block w-full rounded bg-zinc-900 px-3 py-2 text-zinc-100"
        />
      </label>
      <label className="text-sm text-zinc-300">
        password
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          disabled={pending}
          onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
          className="mt-1 block w-full rounded bg-zinc-900 px-3 py-2 text-zinc-100"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-100 px-3 py-2 font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
      >
        {pending ? 'logging in…' : 'log in'}
      </button>
    </form>
  );
}

export default LoginForm;
