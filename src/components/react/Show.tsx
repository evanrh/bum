import type { ReactNode } from 'react';

export type ShowProps = {
  /** Truthy renders `children`; falsy renders `fallback` (or nothing). */
  when: unknown;
  fallback?: ReactNode;
  children: ReactNode;
};

/**
 * Solid-style conditional — maps to an `if` statement. Prefer over bare
 * `{cond && <…/>}` short-circuits (owner's convention, see
 * plans/README.md Conventions).
 */
export function Show({ when, fallback, children }: ShowProps): ReactNode {
  return when ? children : (fallback ?? null);
}
