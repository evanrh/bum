import { useState } from 'react';

import { albumInputSchema } from '../../lib/albums.ts';

export type SubmitFormProps = { weekStart: string };

const textInput = 'mt-1 block w-full rounded bg-zinc-900 px-3 py-2 text-zinc-100';
const errorNote = 'text-xs text-red-300';

/** Coerce the raw stringy draft into the shape the Zod schema expects. */
const normalize = (values: Draft): Record<string, unknown> => ({
  ...values,
  year: values.year === '' || values.year === undefined ? undefined : Number(values.year),
});

type Draft = Record<string, string>;
type SafeParseFailure = {
  success: false;
  error: { issues: Array<{ path: Array<string | number>; message: string }> };
};

const collectFieldErrors = (result: SafeParseFailure): Record<string, string> => {
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
};

/**
 * Album submission form. Shares the T04 Zod schema for live validation;
 * posts to POST /api/albums; surfaces 409 as "already submitted this week"
 * and 403 with the server's named-picker message. Only reachable during
 * your week (the server gates the page).
 */
export function SubmitForm({ weekStart }: SubmitFormProps) {
  const [values, setValues] = useState<Draft>({
    title: '',
    artist: '',
    year: '',
    spotify_url: '',
    youtube_url: '',
    note: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const field = (key: string) => {
    return (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      const next = { ...values, [key]: (event.target as HTMLInputElement).value };
      setValues(next);
      const check = albumInputSchema.safeParse(normalize(next));
      if (!check.success) {
        setFieldErrors(collectFieldErrors(check));
        return;
      }
      setFieldErrors({});
    };
  };

  const fieldInput = (name: string, label: string, type: string, required: boolean) => (
    <div>
      <label className="text-sm text-zinc-300">
        {label}
        <input name={name} type={type} required={required} disabled={pending} onInput={field(name)} className={textInput} />
      </label>
      {fieldErrors[name] && <p className={errorNote}>{fieldErrors[name]}</p>}
    </div>
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending) return; // double-press guard
    const draft = normalize(values);
    const check = albumInputSchema.safeParse(draft);
    if (!check.success) {
      setFieldErrors(collectFieldErrors(check));
      setError(null);
      return;
    }
    setFieldErrors({});
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/albums', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (response.ok) {
        const album = (await response.json()) as { id: string };
        window.location.assign(`/albums/${album.id}`);
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 409) setError('already submitted this week');
      else if (response.status === 403) setError(body.error ?? "it's not your week");
      else if (response.status === 400) setError(body.error ?? 'invalid input');
      else setError(body.error ?? `submission failed (${response.status})`);
      setPending(false);
    } catch {
      setError('network error — try again');
      setPending(false);
    }
  };

  return (
    <form className="flex max-w-md flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {error && (
        <p className="rounded border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-zinc-500">submitting for the week of {weekStart}</p>
      {fieldInput('title', 'title', 'text', true)}
      {fieldInput('artist', 'artist', 'text', true)}
      {fieldInput('year', 'year (1900–2100, optional)', 'number', false)}
      {fieldInput('spotify_url', 'Spotify album URL (optional)', 'url', false)}
      {fieldInput('youtube_url', 'YouTube video URL (optional)', 'url', false)}
      <div>
        <label className="text-sm text-zinc-300">
          note (optional)
          <textarea name="note" rows={2} disabled={pending} onInput={field('note')} className={`${textInput} mt-1`} />
        </label>
        {fieldErrors.note && <p className={errorNote}>{fieldErrors.note}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-100 px-3 py-2 font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
      >
        {pending ? 'submitting…' : 'submit the album'}
      </button>
    </form>
  );
}
