import { afterEach, describe, expect, it } from 'vitest';

import { parseSiteUrl, siteOrigin } from '../../src/lib/config.ts';

describe('parseSiteUrl', () => {
  it('accepts absolute http(s) URLs and trims whitespace', () => {
    expect(parseSiteUrl('https://bum.example.com').origin).toBe('https://bum.example.com');
    expect(parseSiteUrl('  http://127.0.0.1:4321/  ').origin).toBe('http://127.0.0.1:4321');
  });

  it('tolerates paths and ports — the origin is what matters', () => {
    expect(parseSiteUrl('https://bum.example.com/some/path').origin).toBe('https://bum.example.com');
  });

  it('rejects missing or blank values with the actionable message', () => {
    for (const missing of [undefined, null, '', '   ']) {
      expect(() => parseSiteUrl(missing)).toThrow(/SITE_URL is required at runtime/);
    }
  });

  it('rejects relative and non-http values', () => {
    expect(() => parseSiteUrl('bum.example.com')).toThrow(/absolute http\(s\) URL/);
    expect(() => parseSiteUrl('ftp://bum.example.com')).toThrow(/absolute http\(s\) URL/);
  });
});

describe('siteOrigin', () => {
  const original = process.env.SITE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = original;
  });

  it('reads the environment by default and strips the path', () => {
    process.env.SITE_URL = 'https://bum.example.com/';
    expect(siteOrigin()).toBe('https://bum.example.com');
  });

  it('throws with the actionable message when unset', () => {
    delete process.env.SITE_URL;
    expect(() => siteOrigin()).toThrow(/SITE_URL is required at runtime/);
  });

  it('honours an explicit override (test injection)', () => {
    expect(siteOrigin('http://10.0.0.5:8080')).toBe('http://10.0.0.5:8080');
  });
});
