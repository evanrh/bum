import { describe, expect, it } from 'vitest';

import {
  FALLBACK_BLURB,
  joinUrl,
  ogDescription,
  ogImage,
} from '../../src/lib/opengraph.ts';

describe('joinUrl', () => {
  it('joins a path onto the origin, normalizing slashes', () => {
    expect(joinUrl('https://bum.example.com', '/icon.png')).toBe('https://bum.example.com/icon.png');
    expect(joinUrl('https://bum.example.com/', '/icon.png')).toBe('https://bum.example.com/icon.png');
    expect(joinUrl('https://bum.example.com', 'icon.png')).toBe('https://bum.example.com/icon.png');
  });

  it('preserves deeper paths and trailing separators', () => {
    expect(joinUrl('https://bum.example.com/', '/albums/abc/')).toBe(
      'https://bum.example.com/albums/abc/',
    );
  });

  it('throws a SITE_URL-naming error on a malformed origin', () => {
    expect(() => joinUrl('not a url', '/icon.png')).toThrowError(/SITE_URL is misconfigured/);
  });
});

describe('ogDescription', () => {
  const week = '2026-11-16';
  const featuredThisWeek = {
    weekStart: '2026-11-16',
    title: 'Rumours',
    artist: 'Fleetwood Mac',
    submitterName: 'Eli',
    avgScore: 7.3,
    ratingCount: 7,
  };

  it('describes this week’s album with star-unit average and count', () => {
    expect(ogDescription({ week, pickerName: 'Dana', featured: featuredThisWeek })).toBe(
      'Week of 2026-11-16 — “Rumours” by Fleetwood Mac, picked by Eli. 3.7★ from 7 ratings.',
    );
  });

  it('keeps raw stored scores out of user-facing numbers (issue #28)', () => {
    const text = ogDescription({ week, pickerName: null, featured: { ...featuredThisWeek } });
    expect(text).toContain('3.7★ from 7 ratings.');
    expect(text).not.toContain('7.3');
  });

  it('an older featured album drops the current-week prefix', () => {
    expect(ogDescription({ week, pickerName: 'Dana', featured: { ...featuredThisWeek, weekStart: '2026-11-09' } })).toBe(
      '“Rumours” by Fleetwood Mac, picked by Eli. 3.7★ from 7 ratings.',
    );
  });

  it('omits the ratings sentence when nobody rated yet', () => {
    expect(
      ogDescription({ week, pickerName: null, featured: { ...featuredThisWeek, avgScore: null, ratingCount: 0 } }),
    ).toBe('Week of 2026-11-16 — “Rumours” by Fleetwood Mac, picked by Eli.');
  });

  it('defensively skips the ratings sentence without an average', () => {
    expect(
      ogDescription({ week, pickerName: null, featured: { ...featuredThisWeek, avgScore: null, ratingCount: 4 } }),
    ).toBe('Week of 2026-11-16 — “Rumours” by Fleetwood Mac, picked by Eli.');
  });

  it('falls back to whose turn it is when no album is featured', () => {
    expect(ogDescription({ week, pickerName: 'Dana', featured: null })).toBe(
      "Week of 2026-11-16 — Dana's turn to pick.",
    );
  });

  it('empty rotation lands on the static blurb', () => {
    expect(ogDescription({ week, pickerName: null, featured: null })).toBe(FALLBACK_BLURB);
  });

  it('truncates long titles at 250 characters (code points)', () => {
    const title = 'X'.repeat(300);
    const text = ogDescription({
      week,
      pickerName: null,
      featured: { ...featuredThisWeek, title },
    });
    expect(text.length).toBe(250);
    expect(text.endsWith('X'.repeat(9) + '…')).toBe(true);
  });

  it('truncation slices code points, never surrogate pairs', () => {
    const text = ogDescription({
      week,
      pickerName: null,
      featured: { ...featuredThisWeek, title: '🎵'.repeat(200) },
    });
    expect([...text].length).toBe(250); // code points, ellipsis included
    expect([...text].at(-1)).toBe('…');
    // No lone surrogates: every char is a complete code point.
    expect(text).not.toMatch(/\uD800-\uDBFF(?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});

describe('ogImage', () => {
  const origin = 'https://bum.example.com';

  it('passes absolute http(s) cover URLs through untouched', () => {
    const cover = 'https://i.scdn.co/image/ab67616d0000b273abc';
    expect(ogImage({ coverUrl: cover, origin })).toBe(cover);
    expect(ogImage({ coverUrl: 'http://i.ytimg.com/vi/x/hqdefault.jpg', origin })).toBe(
      'http://i.ytimg.com/vi/x/hqdefault.jpg',
    );
  });

  it('falls back to the site icon when nothing resolves', () => {
    expect(ogImage({ coverUrl: null, origin })).toBe('https://bum.example.com/icon.png');
    expect(ogImage({ coverUrl: undefined, origin })).toBe('https://bum.example.com/icon.png');
    expect(ogImage({ coverUrl: '', origin })).toBe('https://bum.example.com/icon.png');
  });

  it('absolutizes relative images a caller may hand over', () => {
    expect(ogImage({ coverUrl: 'icon.png', origin })).toBe('https://bum.example.com/icon.png');
    expect(ogImage({ coverUrl: '/art/og.png', origin })).toBe('https://bum.example.com/art/og.png');
  });
});
