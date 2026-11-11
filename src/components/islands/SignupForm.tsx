import { useState } from 'react';

const jsonPost = async (path: string, body: unknown): Promise<Response> =>
  await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** POST /api/signup — same shape as LoginForm, plus the join code + hint. */
export function SignupForm() {
  const [values, setValues] = useState({ join_code: '', username: '', display_name: '', password: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = (key: keyof typeof values) => (event: React.FormEvent<HTMLInputElement>) =>
    setValues((previous) => ({ ...previous, [key]: (event.target as HTMLInputElement).value }));

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending) return; // double-press guard
    setPending(true);
    setError(null);
    try {
      const response = await jsonPost('/api/signup', values);
      if (response.ok) {
        window.location.assign('/');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `signup failed (${response.status})`);
    } catch {
      setError('network error — try again');
    } finally {
      setPending(false);
    }
  };

  const input = 'mt-1 block w-full rounded bg-zinc-900 px-3 py-2 text-zinc-100';

  return (
    <form className="flex max-w-sm flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {error && (
        <p className="rounded border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      <label className="text-sm text-zinc-300">
        join code
        <input name="join_code" required autoComplete="off" disabled={pending} onInput={field('join_code')} className={input} />
        <span className="mt-1 block text-xs text-zinc-500">ask an admin for the club code</span>
      </label>
      <label className="text-sm text-zinc-300">
        username
        <input name="username" required autoComplete="username" disabled={pending} onInput={field('username')} className={input} />
      </label>
      <label className="text-sm text-zinc-300">
        display name
        <input name="display_name" required autoComplete="nickname" disabled={pending} onInput={field('display_name')} className={input} />
      </label>
      <label className="text-sm text-zinc-300">
        password
        <input type="password" name="password" required autoComplete="new-password" disabled={pending} onInput={field('password')} className={input} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-100 px-3 py-2 font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
      >
        {pending ? 'signing up…' : 'sign up'}
      </button>
    </form>
  );
}

export default SignupForm;
