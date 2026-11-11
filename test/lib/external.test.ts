import { describe, expect, it, vi } from 'vitest';

import {
  parseSpotifyAlbum,
  parseYouTubeVideo,
  resolveCoverUrl,
  spotifyEmbedUrl,
  youtubeEmbedUrl,
} from '../../src/lib/external.ts';
import { ApiError } from '../../src/lib/errors.ts';

const okAlbumId = '1weenld61qoidwYuZ1GESA'; // 22 chars, matches [A-Za-z0-9]{10,64}
const okVideoId = 'f27gQXSnU0M'; // 11 chars

const expectSpotify400 = (input: string, detail?: string) => {
  try {
    parseSpotifyAlbum(input);
    expect.fail(`expected 400 for ${input}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    const message = (error as ApiError).message;
    expect(message).toContain('open.spotify.com/album');
    if (detail) expect(message).toContain(detail);
  }
};

const expectYouTube400 = (input: string, detail?: string) => {
  try {
    parseYouTubeVideo(input);
    expect.fail(`expected 400 for ${input}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    const message = (error as ApiError).message;
    expect(message).toContain('youtube.com/watch');
    if (detail) expect(message).toContain(detail);
  }
};

describe('parseSpotifyAlbum', () => {
  it('accepts the album URL forms and returns the id', () => {
    expect(parseSpotifyAlbum(`https://open.spotify.com/album/${okAlbumId}`)).toBe(okAlbumId);
    expect(parseSpotifyAlbum(`https://open.spotify.com/embed/album/${okAlbumId}`)).toBe(okAlbumId);
    expect(parseSpotifyAlbum(`https://open.spotify.com/album/${okAlbumId}?si=abc123`)).toBe(okAlbumId);
  });

  it('tolerates uppercase hosts and surrounding whitespace', () => {
    expect(parseSpotifyAlbum(`  https://OPEN.SPOTIFY.COM/album/${okAlbumId}  `)).toBe(okAlbumId);
  });

  it('names and rejects track/playlist/user URLs', () => {
    expectSpotify400('https://open.spotify.com/track/4cOdmb2EYvFco9F4AuUKAY', 'track');
    expectSpotify400('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'playlist');
    expectSpotify400('https://open.spotify.com/user/someone', 'user');
  });

  it('rejects everything else: bad hosts, bad ids, garbage', () => {
    expectSpotify400('https://spotify.com/album/1234567890');
    expectSpotify400('spotify:album:1weenld61qoidwYuZ1GESA');
    expectSpotify400(`https://open.spotify.com/album/${'x'.repeat(9)}`); // too short
    expectSpotify400(`https://open.spotify.com/album/${'x'.repeat(65)}`); // too long
    expectSpotify400('https://open.spotify.com/album/has-dashes-11');
    expectSpotify400(`https://open.spotify.com/album/${okAlbumId}/tracks`);
    expectSpotify400('not a url at all');
  });
});

describe('parseYouTubeVideo', () => {
  it('accepts watch, youtu.be, music, and embed forms with any params', () => {
    expect(parseYouTubeVideo(`https://www.youtube.com/watch?v=${okVideoId}`)).toBe(okVideoId);
    expect(parseYouTubeVideo(`https://youtube.com/watch?v=${okVideoId}&t=42s`)).toBe(okVideoId);
    expect(parseYouTubeVideo(`https://youtu.be/${okVideoId}`)).toBe(okVideoId);
    expect(parseYouTubeVideo(`https://music.youtube.com/watch?v=${okVideoId}`)).toBe(okVideoId);
    expect(parseYouTubeVideo(`https://m.youtube.com/watch?v=${okVideoId}`)).toBe(okVideoId);
    expect(parseYouTubeVideo(`https://youtube-nocookie.com/embed/${okVideoId}`)).toBe(okVideoId);
    expect(parseYouTubeVideo(`  https://youtu.be/${okVideoId}  `)).toBe(okVideoId);
  });

  it('rejects playlist-only URLs but accepts list= alongside v=', () => {
    expectYouTube400(`https://www.youtube.com/playlist?list=${'P'.repeat(30)}`, 'playlist');
    expectYouTube400(`https://www.youtube.com/watch?list=${'P'.repeat(30)}`, 'playlist');
    expect(parseYouTubeVideo(`https://www.youtube.com/watch?v=${okVideoId}&list=${'P'.repeat(30)}`)).toBe(okVideoId);
  });

  it('rejects wrong hosts, wrong id shapes, and garbage', () => {
    expectYouTube400('https://vimeo.com/12345678901');
    expectYouTube400(`https://youtube.com/watch?v=${'ab'}&extra=1`);
    expectYouTube400(`https://youtu.be/${'a'.repeat(10)}`);
    expectYouTube400(`https://youtu.be/${'a'.repeat(12)}`);
    expectYouTube400(`https://youtube.com/watch?v=${'!'.repeat(11)}`);
    expectYouTube400(`https://youtube.com/shorts/${okVideoId}`);
    expectYouTube400(`https://youtube.com/embed/${'a'.repeat(11)}/extra`);
    expectYouTube400('complete garbage');
  });
});

describe('embed URL builders', () => {
  it('produce the locked frozen strings', () => {
    expect(spotifyEmbedUrl('ALBUMID123')).toBe('https://open.spotify.com/embed/album/ALBUMID123');
    expect(youtubeEmbedUrl('abc-_1234567')).toBe('https://www.youtube-nocookie.com/embed/abc-_1234567');
  });
});

describe('resolveCoverUrl', () => {
  const oembedFetchWith = (body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it('spotify id → oEmbed thumbnail_url (fetch hits the oembed endpoint)', async () => {
    const fetchImpl = oembedFetchWith({ thumbnail_url: 'https://example.com/cover.jpg' });
    const cover = await resolveCoverUrl({ spotifyId: okAlbumId }, fetchImpl as unknown as typeof fetch);
    expect(cover).toBe('https://example.com/cover.jpg');
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://open.spotify.com/oembed/?url=https://open.spotify.com/album/${okAlbumId}`,
      expect.anything(),
    );
  });

  it('spotify response without thumbnail_url → null; non-ok → null', async () => {
    expect(
      await resolveCoverUrl({ spotifyId: okAlbumId }, oembedFetchWith({}) as unknown as typeof fetch),
    ).toBeNull();
    const notOk = vi.fn(async () => new Response('nope', { status: 404 }));
    expect(await resolveCoverUrl({ spotifyId: okAlbumId }, notOk as unknown as typeof fetch)).toBeNull();
  });

  it('fetch failure (offline/timeout) → null, never throws', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await resolveCoverUrl({ spotifyId: okAlbumId }, failing as unknown as typeof fetch)).toBeNull();
  });

  it('youtube-only → ytimg constant, no fetch performed', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const cover = await resolveCoverUrl({ youtubeId: okVideoId }, fetchImpl as unknown as typeof fetch);
    expect(cover).toBe('https://i.ytimg.com/vi/f27gQXSnU0M/hqdefault.jpg');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('neither id → null, spotify failure with a youtube fallback id → null (no fallback per spec)', async () => {
    expect(await resolveCoverUrl({}, vi.fn() as unknown as typeof fetch)).toBeNull();
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(
      await resolveCoverUrl(
        { spotifyId: okAlbumId, youtubeId: okVideoId },
        failing as unknown as typeof fetch,
      ),
    ).toBeNull();
  });
});
