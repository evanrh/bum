import { describe, expect, it } from 'vitest';

import { scoreStars } from '../../src/lib/scale.ts';

describe('scoreStars (scale display conversion)', () => {
  it('renders stored half-star integers in star units with the ★ marker', () => {
    expect(scoreStars(10)).toBe('5★'); // a perfect stored 10 → 5 stars
    expect(scoreStars(7)).toBe('3.5★');
    expect(scoreStars(3)).toBe('1.5★');
    expect(scoreStars(6)).toBe('3★'); // whole stars have no decimal
    expect(scoreStars(2)).toBe('1★');
  });

  it('renders stored averages (fractional half-star units) at one decimal', () => {
    expect(scoreStars(7.3)).toBe('3.7★'); // the exact inconsistency from #28
    expect(scoreStars(6.5)).toBe('3.3★');
    expect(scoreStars(8.5)).toBe('4.3★');
  });

  it('unrated albums keep the dash', () => {
    expect(scoreStars(null)).toBe('—');
    expect(scoreStars(undefined)).toBe('—');
  });
});
