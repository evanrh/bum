import type { ReactNode } from 'react';

export type MatchProps = {
  /** Truthy → this Match's children render. */
  when: unknown;
  children: ReactNode;
};

/** One arm of a <Switch>. Standalone it behaves like <Show> without fallback. */
export function Match({ when, children }: MatchProps): ReactNode {
  return when ? children : null;
}
