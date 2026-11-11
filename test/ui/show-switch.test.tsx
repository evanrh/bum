// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { render, screen } from '@testing-library/react';

import { Match } from '../../src/components/react/Match.tsx';
import { Show } from '../../src/components/react/Show.tsx';
import { Switch } from '../../src/components/react/Switch.tsx';

describe('<Show>', () => {
  it('renders children when `when` is truthy', () => {
    render(<Show when={'yes'}>{'shown'}</Show>);
    expect(screen.getByText('shown')).toBeTruthy();
  });

  it('renders nothing on false/0/empty string/null/undefined', () => {
    for (const falsy of [false, 0, '', null, undefined]) {
      const { container, unmount } = render(<Show when={falsy as unknown}>{'hidden'}</Show>);
      expect(container.textContent).toBe('');
      unmount();
    }
  });

  it('renders the fallback when `when` is falsy', () => {
    render(<Show when={null} fallback={'the fallback'}>{'main'}</Show>);
    expect(screen.queryByText('main')).toBeNull();
    expect(screen.queryByText('the fallback')).toBeTruthy();
  });
});

describe('<Switch> + <Match>', () => {
  it('renders the first matching arm (priority order), nothing when none match', () => {
    const { rerender } = render(
      <Switch>
        <Match when={false}>{'first'}</Match>
        <Match when={'truthy string'}>{'second'}</Match>
        <Match when={true}>{'third'}</Match>
      </Switch>,
    );
    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.queryByText('third')).toBeNull(); // first-wins
    expect(screen.queryByText('first')).toBeNull();

    const { container } = render(
      <Switch>
        <Match when={false}>{'first'}</Match>
        <Match when={''}>{'second'}</Match>
      </Switch>,
    );
    expect(container.textContent).toBe('');
  });

  it('Match used standalone behaves like Show without fallback', () => {
    render(
      <>
        <Match when={true}>{'renders'}</Match>
        <Match when={false}>{'does not'}</Match>
      </>,
    );
    expect(screen.getByText('renders')).toBeTruthy();
    expect(screen.queryByText('does not')).toBeNull();
  });
});
