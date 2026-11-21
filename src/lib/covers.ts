import type { Db } from '../db/index.ts';
import * as albumsRepo from '../db/repos/albums.ts';
import { resolveCoverUrl } from './external.ts';

/**
 * Cover-art backfill (issue #14): covers are resolved on insert, but Spotify
 * silently killed the trailing-slash oEmbed path for a while — so existing
 * rows shipped with cover_url = null. This one-shot sweep re-resolves every
 * album without a stored cover and persists the result, exactly the insert
 * path's semantics: Spotify via public oEmbed, YouTube-only via the ytimg
 * constant, unknown external ids → no cover possible.
 */

export type BackfillCoverOptions = {
  fetch?: typeof fetch;
  log?: (message: string) => void;
};

export type BackfillCoverSummary = {
  /** Albums that had a null cover_url when the sweep began. */
  scanned: number;
  /** Resolved and persisted (spotify or youtube ids). */
  resolved: number;
  /** No external ids on the row — nothing to resolve. */
  unresolvable: number;
  /** External ids exist but the network said no (null per spec). */
  failed: number;
};

export async function backfillCovers(
  db: Db,
  opts: BackfillCoverOptions = {},
): Promise<BackfillCoverSummary> {
  const fetchImpl = opts.fetch ?? fetch.bind(globalThis);
  const log = opts.log ?? (() => {});
  const summary: BackfillCoverSummary = { scanned: 0, resolved: 0, unresolvable: 0, failed: 0 };

  const missing = await albumsRepo.listAlbumsWithoutCover(db);
  summary.scanned = missing.length;

  for (const album of missing) {
    if (album.spotifyId == null && album.youtubeId == null) {
      summary.unresolvable += 1;
      log(`[covers] ${album.title} (${album.id}) has no external id — no cover possible`);
      continue;
    }
    const coverUrl = await resolveCoverUrl(
      { spotifyId: album.spotifyId, youtubeId: album.youtubeId },
      fetchImpl,
    );
    if (coverUrl === null) {
      summary.failed += 1;
      log(`[covers] ${album.title} (${album.id}) — resolution failed (staying null)`);
      continue;
    }
    await albumsRepo.updateAlbum(db, album.id, { coverUrl });
    summary.resolved += 1;
    log(`[covers] ${album.title} (${album.id}) → ${coverUrl}`);
  }

  return summary;
}
