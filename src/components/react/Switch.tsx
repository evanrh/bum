import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

import type { MatchProps } from './Match.tsx';

export type SwitchProps = {
  children: ReactElement<MatchProps> | Array<ReactElement<MatchProps>>;
};

/**
 * Solid-style switch — maps to a `switch` statement. Renders the first
 * <Match> whose `when` is truthy; everything after it is ignored (write
 * arms in priority order). No match → null.
 */
export function Switch({ children }: SwitchProps): ReactNode {
  const arms = Children.toArray(children).filter(isValidElement) as Array<
    ReactElement<MatchProps>
  >;
  const winner = arms.find((arm) => Boolean(arm.props.when));
  return winner ?? null;
}
