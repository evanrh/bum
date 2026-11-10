import { describe, expect, it } from 'vitest';

import {
  TIMEZONE,
  addWeeksISO,
  currentTurn,
  daysBetweenISO,
  parseQueue,
  pendingAdvances,
  rotateQueue,
  weekId,
  weekStartsAt,
} from '../../src/lib/rotation.ts';

/** Pinned UTC instants: ms values computed against known Eastern wall clocks. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(Date.UTC(y, mo - 1, d, h, mi));

describe('week ids (Eastern calendar)', () => {
  it('locks the single-operator timezone assumption', () => {
    expect(TIMEZONE).toBe('America/New_York');
  });

  it('places instants one second either side of a Monday boundary correctly', () => {
    // Week of Mon 2026-01-05; Eastern weeks start Monday 00:00 (EST = UTC−5).
    expect(weekId(at(2026, 1, 5, 4, 59))).toBe('2025-12-29'); // Sun 23:59 EST
    expect(weekId(at(2026, 1, 5, 5, 0))).toBe('2026-01-05'); // Mon 00:00 EST
    expect(weekId(at(2026, 1, 6, 16, 0))).toBe('2026-01-05'); // Tue 11:00 EST
  });

  it('keeps Sunday evening in the week that started six days earlier', () => {
    // Sun 2026-11-01 23:30 EST (after fall-back) → Monday 2026-10-26.
    expect(weekId(at(2026, 11, 2, 4, 30))).toBe('2026-10-26');
  });

  it('is immune to the DST clock shifts on the transition Sundays', () => {
    // Spring forward 2026-03-08: 01:30 exists twice (EST and EDT) — both
    // belong to the week of Monday 2026-03-02.
    expect(weekId(at(2026, 3, 8, 6, 30))).toBe('2026-03-02');
    expect(weekId(at(2026, 3, 8, 7, 30))).toBe('2026-03-02');
    // Fall back 2026-11-01: 01:30 exists twice (EDT and EST).
    expect(weekId(at(2026, 11, 1, 5, 30))).toBe('2026-10-26');
    expect(weekId(at(2026, 11, 1, 6, 30))).toBe('2026-10-26');
  });

  it('converts week ids to Monday-midnight instants across both transitions', () => {
    // EST Mondays are 05:00Z; EDT Mondays are 04:00Z.
    expect(weekStartsAt('2026-03-02').toISOString()).toBe('2026-03-02T05:00:00.000Z');
    expect(weekStartsAt('2026-03-09').toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(weekStartsAt('2026-10-26').toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(weekStartsAt('2026-11-02').toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('calendar-day arithmetic', () => {
  it('counts days across month and year boundaries', () => {
    expect(daysBetweenISO('2026-01-05', '2025-12-29')).toBe(7);
    expect(daysBetweenISO('2025-12-29', '2026-01-05')).toBe(-7);
  });

  it('still counts DST-spanning weeks as exactly 7 days (calendar-day rule)', () => {
    // 2026-03-02 → 2026-03-23 spans the spring-forward transition.
    expect(daysBetweenISO('2026-03-23', '2026-03-02')).toBe(21);
    expect(Math.floor(daysBetweenISO('2026-03-23', '2026-03-02') / 7)).toBe(3);
  });

  it('addWeeksISO crosses month, year, and DST boundaries', () => {
    expect(addWeeksISO('2025-12-29', 1)).toBe('2026-01-05');
    expect(addWeeksISO('2026-12-28', 1)).toBe('2027-01-04');
    expect(addWeeksISO('2026-03-02', 1)).toBe('2026-03-09');
    expect(addWeeksISO('2026-11-02', -1)).toBe('2026-10-26');
  });
});

describe('queue ops', () => {
  it('rotateQueue pops the head and appends it at the back', () => {
    expect(rotateQueue([1, 2, 3])).toEqual({ queue: [2, 3, 1], moved: 1 });
    expect(rotateQueue([1, 2, 3, 4, 5]).queue).toEqual([2, 3, 4, 5, 1]);
  });

  it('rotateQueue: empty queue is a no-op with moved null', () => {
    expect(rotateQueue([])).toEqual({ queue: [], moved: null });
  });

  it('a single-member queue is compositionally a no-op', () => {
    expect(rotateQueue([7])).toEqual({ queue: [7], moved: 7 });
  });

  it('parseQueue is tolerant of junk and filters non-number elements', () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue('')).toEqual([]);
    expect(parseQueue('   ')).toEqual([]);
    expect(parseQueue('garbage')).toEqual([]);
    expect(parseQueue('["a", 3]')).toEqual([3]); // junk elements are dropped, not the queue
    expect(parseQueue('[]')).toEqual([]);
    expect(parseQueue('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(parseQueue('[1, "2", null, 4]')).toEqual([1, 4]);
    expect(parseQueue('"just a string"')).toEqual([]);
    expect(parseQueue([5, 9])).toEqual([5, 9]);
  });
});

describe('pendingAdvances', () => {
  it('bootstraps: null checkpoint → 0', () => {
    expect(pendingAdvances(null, '2026-01-05')).toBe(0);
  });

  it('counts elapsed whole weeks, including a 12-week catch-up', () => {
    expect(pendingAdvances('2026-01-05', '2026-01-05')).toBe(0);
    expect(pendingAdvances('2026-01-05', '2026-01-12')).toBe(1);
    expect(pendingAdvances('2026-01-05', '2026-01-19')).toBe(2);
    expect(pendingAdvances('2026-01-05', '2026-03-30')).toBe(12);
  });

  it('counts a DST-spanning range as whole weeks (3-week outage)', () => {
    expect(pendingAdvances('2026-03-02', '2026-03-23')).toBe(3);
  });

  it('treats a future checkpoint (restored backup) as zero', () => {
    expect(pendingAdvances('2026-03-23', '2026-03-02')).toBe(0);
  });
});

describe('currentTurn', () => {
  it('returns the queue head, the week id, and both boundary instants', () => {
    const turn = currentTurn({ rotation: '[5, 9]' }, at(2026, 3, 3, 15)); // Tue
    expect(turn.week).toBe('2026-03-02');
    expect(turn.pickerId).toBe(5);
    expect(turn.startedAt.toISOString()).toBe('2026-03-02T05:00:00.000Z');
    expect(turn.endsAt.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('the spring-forward week spans exactly 167 hours (an hour is lost to EDT)', () => {
    const turn = currentTurn({ rotation: '[1]' }, at(2026, 3, 4, 12));
    expect(
      (turn.endsAt.getTime() - turn.startedAt.getTime()) / (60 * 60 * 1000),
    ).toBe(167); // 24h − 1h (losing an hour to EDT)
  });

  it('an empty or unset queue has no picker', () => {
    expect(currentTurn({ rotation: '[]' }, at(2026, 7, 1, 13)).pickerId).toBeNull();
    expect(currentTurn({ rotation: null }, at(2026, 7, 1, 13)).pickerId).toBeNull();
    expect(currentTurn({ rotation: 'garbage' }, at(2026, 7, 1, 13)).pickerId).toBeNull();
  });

  it('accepts an already-parsed queue array', () => {
    const turn = currentTurn({ rotation: [11, 12] }, at(2026, 11, 10, 15));
    expect(turn.week).toBe('2026-11-09');
    expect(turn.pickerId).toBe(11);
    expect(turn.startedAt.toISOString()).toBe('2026-11-09T05:00:00.000Z'); // EST
    expect(turn.endsAt.toISOString()).toBe('2026-11-16T05:00:00.000Z');
  });
});
