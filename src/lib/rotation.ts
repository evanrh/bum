/**
 * Rotation engine — pure functions.
 *
 * Implemented in plans/T02-rotation-engine.md. The DB-facing reconciliation
 * job that consumes these functions lands with T05.
 */

export type WeekStartOptions = {
  /** 0 = Sunday … 6 = Saturday (matches Date#getDay). */
  weekStartDay: number;
  /** Hour (0-23) at which the week boundary occurs. */
  weekStartHour: number;
  /** IANA time zone name, e.g. "America/New_York". */
  timezone: string;
};

/** ISO date (YYYY-MM-DD) helpers and week math land in T02. */
export {};
