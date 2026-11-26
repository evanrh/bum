import type { ReactNode } from 'react';

export type AlbumFiltersProps = {
  /** Active members for the "by submitter" dropdown (id + display name). */
  submitters: Array<{ id: number; name: string }>;
  /** Currently-applied submitter filter from the server's query params. */
  by?: number;
};

/**
 * URL-state filter — the submitter dropdown only updates the location; the
 * server re-renders. Sorting does not live here: the AlbumGrid island keeps
 * it in client state (issue #62). Dependency-free on purpose.
 */
export function AlbumFilters({ submitters, by }: AlbumFiltersProps): ReactNode {
  const navigate = (params: URLSearchParams): void => {
    const query = params.toString();
    window.location.assign(query === '' ? '/albums' : `/albums?${query}`);
  };

  const apply = (key: string, value: string | null): void => {
    const params = new URLSearchParams(window.location.search);
    if (value === null) params.delete(key);
    else params.set(key, value);
    params.delete('page'); // filter change resets pagination
    navigate(params);
  };

  const submitterName = submitters.find((candidate) => candidate.id === by)?.name ?? 'everyone';

  return (
    <details className="relative">
      <summary className="cursor-pointer rounded border border-zinc-800 bg-zinc-900 px-3 py-1 text-sm text-zinc-300">
        by: {submitterName}
      </summary>
      <div className="absolute z-10 mt-1 w-48 rounded border border-zinc-800 bg-zinc-950 py-1 text-sm">
        <button
          type="button"
          onClick={() => apply('by', null)}
          className="block w-full px-3 py-1.5 text-left text-zinc-300 hover:bg-zinc-900"
        >
          everyone
        </button>
        {submitters.map((submitter) => (
          <button
            key={submitter.id}
            type="button"
            onClick={() => apply('by', String(submitter.id))}
            className="block w-full px-3 py-1.5 text-left text-zinc-300 hover:bg-zinc-900"
          >
            {submitter.name}
          </button>
        ))}
      </div>
    </details>
  );
}

export default AlbumFilters;
