# T02 — Rotation engine

Status: ⬜
Depends on: T01 (types only — this ticket's logic is pure and DB-free)

## Goal

Implement the pure rotation engine in `src/lib/rotation.ts` (currently a
documented placeholder). This is the heart of the app and must be
timezone-correct and exhaustively unit-tested. **No astro imports, no DB
access** — pure functions over plain data.

## Spec (see `plans/README.md` "Rotation semantics" for the locked model)

Export from `src/lib/rotation.ts`:

```ts
export type WeekStartOptions = {
  weekStartDay: number;   // 0=Sun … 6=Sat
  weekStartHour: number;  // 0-23
  timezone: string;       // IANA name
};

// --- week math ---
startOfWeek(instant: Date, opts: WeekStartOptions): Date
weekStartISO(instant: Date, opts: WeekStartOptions): string      // YYYY-MM-DD
addWeeksISO(weekStart: string, weeks: number): string
weekIndex(now: Date, settings: {rotation_epoch: string} & WeekStartOptions): number
daysBetweenISO(a: string, b: string): number  // calendar days, a - b

// --- picker math ---
activeMembers(users: User[]): User[]            // is_active, by rotation_order asc
euclideanMod(a: number, b: number): number      // ((a % b) + b) % b
pickerFor(users: User[], weekIndex: number, rotationOffset: number): User | null

// --- convenience used by the app layer ---
currentTurn(settings, users, now):
  { weekStart: string; weekIndex: number; picker: User | null; startedAt: Date; endsAt: Date }
```

Implementation requirements:

1. **Week boundary** must honor `weekStartDay`/`weekStartHour` in
   `timezone`. Compute by walking the target weekday in the zone: use
   `Intl.DateTimeFormat` with `timeZone`, `hour12: false`, to get local
   parts of candidate instants, adjusting for offset shifts (standard
   pattern: iterate/adjust ±1 day until local weekday/hour match). Do not
   use `Date#getTimezoneOffset` (that's the host zone, not the target).
2. **weekIndex** is calendar-day based as locked: normalize the epoch with
   `startOfWeek` first, then `floor(daysBetweenISO(weekStartISO(now),
   weekStartISO(epoch)) / 7)`. Wall-clock/DST hour drift must never
   change the index; only crossing a boundary date does.
3. **Normalization**: if `rotation_epoch` is not itself a week start, it
   is silently normalized (an epoch mid-week still means "that week is
   week 0").
4. `pickerFor` handles: empty list → null; negative indices (epoch in the
   future); offsets beyond ±many; offsets added to weekIndex before mod.
5. `currentTurn` returns `endsAt` = next week's start instant (used for
   the dashboard countdown) and `startedAt` = this week's start.

## Tests — `test/lib/rotation.test.ts`

Timezone-correctness is the risk area; test it hard:

- helper to build a `Date` from local parts in a zone (e.g. via
  `getOffsetMs` construction in tests) — keep tests timezone-explicit,
  never host-zone-dependent (CI may run anywhere)
- weekStart: for **America/New_York** across both DST transitions (March /
  November): boundary instants every day/hour of the transition weeks
- weekStart: UTC, and a half-hour offset zone (Asia/Kolkata), and a
  southern-hemisphere zone (Australia/Sydney, DST opposite sign)
- boundaries: `week_start_hour` = 0, 14, 23 — instants one second before
  and one second after each boundary land in the correct week
- weekIndex: monotonic across a boundary; unchanged across a DST "spring
  forward" 23-hour week (calendar-day rule); epoch normalization (epoch
  set to Wednesday normalizes to that week's Monday-equivalent)
- pickerFor: single member; empty list; weekIndex × offset matrix
  (offset 0/1/5/-1, indices 0-9); disabled member mid-cycle (count change
  shifts subsequent picks — assert explicit expected sequences)
- integration-style: a full simulated cycle — 5 members, 12 weeks,
  offset bumped +1 after week 4 (admin skip): assert the complete picker
  sequence with the burned turn (skipped member lands at the end of the
  cycle, not one week later in place)
- negative weekIndex (now before epoch) → submissions-disabled domain is
  the caller's concern, but pickerFor/weekIndex must not throw

## Acceptance criteria

- [ ] `src/lib/rotation.ts` exports the full surface above with no DB/astro
      imports
- [ ] Coverage of `src/lib/rotation.ts` is ~100% (this file is cheap to
      cover — do it)
- [ ] All cases above green; `npm run test:coverage` passes

## Out of scope

Recording skips (T05), the admin skip endpoint (T07 — it only writes
`rotation_offset` + a `skipped_turns` row), rendering.
