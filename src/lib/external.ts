import { ApiError } from './errors.ts';

/**
 * External URL parsing, embed builders, and cover resolution — no API
 * keys, no auth (locked spec in plans/README.md). Users paste full URLs;
 * we parse server-side and store only ids.
 */

const SPOTIFY_ID = /^[A-Za-z0-9]{10,64}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const SPOTIFY_HINT =
  'paste a Spotify album URL: open.spotify.com/album/{id} or open.spotify.com/embed/album/{id}';
const YOUTUBE_HINT =
  'paste a YouTube video URL: youtube.com/watch?v={id}, youtu.be/{id}, or youtube.com/embed/{id}';

function notSpotifyAlbum(detail?: string): ApiError {
  return new ApiError(400, detail ? `${detail} — ${SPOTIFY_HINT}` : `not a Spotify album URL — ${SPOTIFY_HINT}`);
}

function notYouTubeVideo(detail?: string): ApiError {
  return new ApiError(
    400,
    detail ? `${detail} — ${YOUTUBE_HINT}` : `not a YouTube video URL — ${YOUTUBE_HINT}`,
  );
}

/**
 * Accept `open.spotify.com/album/{id}` (or `/embed/album/{id}`), query
 * strings allowed. Track/playlist/user/anything-else URLs are rejected
 * with guidance.
 */
export function parseSpotifyAlbum(input: string): string {
  const candidate = input.trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw notSpotifyAlbum(`"${input.trim().slice(0, 60)}" is not a URL`);
  }
  if (url.hostname !== 'open.spotify.com') throw notSpotifyAlbum();
  const segments = url.pathname.split('/').filter(Boolean);
  const rejectedKinds = new Set(['track', 'playlist', 'user', 'episode', 'show']);
  if (segments.length > 0 && rejectedKinds.has(segments[0])) {
    throw notSpotifyAlbum(`that is a Spotify ${segments[0]} URL`);
  }
  let id: string | undefined;
  if (segments.length === 2 && segments[0] === 'album') id = segments[1];
  else if (segments.length === 3 && segments[0] === 'embed' && segments[1] === 'album') {
    id = segments[2];
  }
  if (!id || !SPOTIFY_ID.test(id)) throw notSpotifyAlbum();
  return id;
}

/** Hosts the YouTube parsers accept (mobile + music + nocookie included). */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
]);

/**
 * Accept `youtube.com/watch?v={id}` (any params), `youtu.be/{id}`,
 * `music.youtube.com/watch?v={id}`, `youtube.com/embed/{id}`; id is
 * `[A-Za-z0-9_-]{11}`. A `list=` param without `v=` is a playlist → 400
 * with guidance.
 */
export function parseYouTubeVideo(input: string): string {
  const candidate = input.trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw notYouTubeVideo(`"${candidate.slice(0, 60)}" is not a URL`);
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) throw notYouTubeVideo();
  const segments = url.pathname.split('/').filter(Boolean);

  let id: string | undefined;
  if (hostedAt(url, 'youtu.be')) {
    if (segments.length === 1) id = segments[0];
  } else if (segments.length >= 1 && segments[0] === 'playlist') {
    throw new ApiError(400, `that is a YouTube playlist — ${YOUTUBE_HINT}`);
  } else if (segments.at(-1) === 'watch' || segments[0] === 'watch') {
    const video = url.searchParams.get('v');
    const list = url.searchParams.get('list');
    if (!video && list) {
      throw new ApiError(400, `that is a YouTube playlist — ${YOUTUBE_HINT}`);
    }
    id = video ?? undefined;
  } else if (segments.length === 2 && segments[0] === 'embed') {
    id = segments[1];
  }

  if (!id || !YOUTUBE_ID.test(id)) throw notYouTubeVideo();
  return id;
}

function hostedAt(url: URL, host: string): boolean {
  return url.hostname === host;
}

export const spotifyEmbedUrl = (id: string): string => `https://open.spotify.com/embed/album/${id}`;
export const youtubeEmbedUrl = (id: string): string => `https://www.youtube-nocookie.com/embed/${id}`;

const SPOTIFY_OEMBED_TIMEOUT_MS = 5000;
const youtubeThumbnail = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/**
 * Best-effort cover art: with a Spotify id, hit the public oEmbed endpoint
 * and take `thumbnail_url`; with only a YouTube id, use the ytimg URL;
 * anything failed/absent → null. Never throws. Accepts a fetch
 * implementation so tests inject a stub.
 */
export async function resolveCoverUrl(
  ids: { spotifyId?: string | null; youtubeId?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (ids.spotifyId) {
    try {
      const response = await fetchImpl(
        `https://open.spotify.com/oembed/?url=https://open.spotify.com/album/${ids.spotifyId}`,
        { signal: AbortSignal.timeout(SPOTIFY_OEMBED_TIMEOUT_MS) },
      );
      if (!response.ok) return null;
      const json = (await response.json()) as { thumbnail_url?: unknown };
      return typeof json.thumbnail_url === 'string' ? json.thumbnail_url : null;
    } catch {
      return null; // network/timeout/parse failure is non-fatal by design
    }
  }
  if (ids.youtubeId) return youtubeThumbnail(ids.youtubeId);
  return null;
}
