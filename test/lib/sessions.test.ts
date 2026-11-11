import { describe, expect, it } from 'vitest';

import { createSessionStore } from '../../src/lib/sessions.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('in-memory session store', () => {
  it('create → resolve returns the same userId; unknown tokens → null', () => {
    const store = createSessionStore();
    const { token } = store.create(7, 1000);
    expect(store.resolve(token, 2000)).toBe(7);
    expect(store.resolve('not-a-real-token', 2000)).toBeNull();
    expect(store.size()).toBe(1);
  });

  it('mints distinct tokens per session', () => {
    const store = createSessionStore();
    const a = store.create(1, 1000);
    const b = store.create(1, 1000);
    expect(a.token).not.toBe(b.token);
    expect(store.size()).toBe(2);
  });

  it('expired entries resolve to null and are dropped lazily', () => {
    const store = createSessionStore();
    const { token } = store.create(7, 0, DAY);
    expect(store.resolve(token, DAY - 1)).toBe(7);
    expect(store.resolve(token, DAY)).toBeNull(); // expired exactly at boundary
    expect(store.size()).toBe(0); // lazily dropped
  });

  it('drop ends one session only', () => {
    const store = createSessionStore();
    const a = store.create(1, 0);
    const b = store.create(2, 0);
    store.drop(a.token);
    expect(store.resolve(a.token, 1000)).toBeNull();
    expect(store.resolve(b.token, 1000)).toBe(2);
  });

  it('dropUser ends every session for that user', () => {
    const store = createSessionStore();
    const a = store.create(1, 0);
    const b = store.create(1, 0);
    const c = store.create(2, 0);
    store.dropUser(1);
    expect(store.resolve(a.token, 1000)).toBeNull();
    expect(store.resolve(b.token, 1000)).toBeNull();
    expect(store.resolve(c.token, 1000)).toBe(2);
  });

  it('clear empties the store', () => {
    const store = createSessionStore();
    store.create(1, 0);
    store.create(2, 0);
    store.clear();
    expect(store.size()).toBe(0);
  });
});
