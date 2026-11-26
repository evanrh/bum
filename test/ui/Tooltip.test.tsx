// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { Tooltip } from '../../src/components/react/Tooltip.tsx';

const mount = (placement?: 'top' | 'bottom') => {
  const view = render(
    <Tooltip text="Demote" {...(placement ? { placement } : {})}>
      <button type="button" title="Demote" aria-label="demote bob">
        act
      </button>
    </Tooltip>,
  );
  const button = screen.getByRole('button', { name: 'demote bob' });
  return { button, tip: screen.getByText('Demote') };
};

const stubRects = (trigger: DOMRect, tipBox: DOMRect): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'tip' ? tipBox : trigger;
  });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<Tooltip> (issue #58 — Bootstrap-style tip)', () => {
  it('stays hidden until hovered, then fades in through a body portal; hides on mouse-leave', () => {
    const { button, tip } = mount();
    expect(tip.getAttribute('aria-hidden')).toBe('true');
    expect(tip.className).toContain('opacity-0');
    expect(tip.className).toContain('invisible');

    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(tip.className).toContain('opacity-100');
    expect(tip.parentElement).toBe(document.body);

    fireEvent.mouseLeave(button.parentElement as HTMLElement);
    expect(tip.className).toContain('opacity-0');
    expect(tip.className).toContain('invisible');
  });

  it('opens on keyboard focus and leaves the trigger title untouched, hides on blur', () => {
    const { button, tip } = mount();
    expect(button.getAttribute('title')).toBe('Demote');
    fireEvent.focus(button);
    expect(tip.className).toContain('opacity-100');
    expect(button.getAttribute('title')).toBe('Demote');
    fireEvent.blur(button);
    expect(tip.className).toContain('opacity-0');
  });

  it('opens above the trigger by default with the arrow on its bottom edge', () => {
    stubRects(new DOMRect(500, 300, 28, 28), new DOMRect(0, 0, 120, 30));
    const { button, tip } = mount();
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(tip.getAttribute('data-placement')).toBe('top');
    expect(tip.style.left).toBe('454px');
    expect(tip.style.top).toBe('266px');
    const arrow = tip.querySelector('span') as HTMLElement;
    expect(arrow.className).toContain('rotate-45');
    expect(arrow.className).toContain('-bottom-1');
  });

  it('flips below the trigger when the top side would overflow the viewport', () => {
    stubRects(new DOMRect(500, 2, 28, 28), new DOMRect(0, 0, 120, 30));
    const { button, tip } = mount();
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(tip.getAttribute('data-placement')).toBe('bottom');
    expect(tip.style.top).toBe('34px');
    expect(tip.querySelector('span')!.className).toContain('-top-1');
  });
});
