import type { ReactNode } from 'react';

import { Show } from './Show.tsx';

export type AlbumCardProps = {
  title: string;
  artist: string;
  year?: number | null;
  coverUrl?: string | null;
  note?: string | null;
  nextUp?: boolean;
  children?: ReactNode;
};

/** React counterpart of AlbumCard.astro for the client-side backlog island. */
export function AlbumCard({ title, artist, year, coverUrl, note, nextUp, children }: AlbumCardProps) {
  return (
    <div className="album-card relative h-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-600">
      <Show
        when={coverUrl}
        fallback={
          <div className="album-card-fallback aspect-square w-full bg-gradient-to-br from-zinc-800 via-zinc-800 to-zinc-900" aria-hidden="true" />
        }
      >
        <img src={coverUrl ?? undefined} alt={`cover of ${title}`} loading="lazy" className="aspect-square w-full object-cover" />
      </Show>
      <Show when={nextUp}>
        <span className="absolute top-2 left-2 rounded bg-zinc-950/80 px-2 py-1 text-xs font-medium text-amber-400" title="auto-set when your week starts">
          next up
        </span>
      </Show>
      <div className="p-4">
        <h3 className="font-medium text-zinc-100">{title}</h3>
        <p className="text-sm text-zinc-400">{artist}{year ? ` (${year})` : ''}</p>
        <Show when={note}>
          <p className="mt-2 text-xs italic text-zinc-300">“{note}”</p>
        </Show>
        <Show when={children}>
          <div className="mt-3 flex items-center justify-between gap-2">{children}</div>
        </Show>
      </div>
    </div>
  );
}
